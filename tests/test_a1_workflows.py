"""Reads every GitHub workflow and action file the way GitHub would have to, and checks the rules a broken
file would break: it parses, every job and step has what it needs, every step id, job and local action that is
mentioned exists, and the real render job still has today's install as its fallback. (GitHub itself can't be
reached from here, so this is the check that stands in for it.) Asserts; exits non-zero on failure."""
import where as _W
import glob, os, re, sys, yaml

ROOT = f"{_W.ROOT}"
fails = []
def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + (("  | " + str(detail)) if detail != "" and not ok else ""))
    if not ok: fails.append(name)

STEP_KEYS = {"name", "id", "if", "uses", "run", "with", "env", "shell", "continue-on-error", "timeout-minutes", "working-directory"}
JOB_KEYS = {"name", "needs", "runs-on", "timeout-minutes", "steps", "if", "env", "permissions", "outputs", "strategy", "concurrency"}
TOP_KEYS = {"name", "on", True, "permissions", "jobs", "env", "concurrency", "defaults", "run-name"}
LONG_WAY = "sudo apt-get update -qq\nsudo apt-get install -y -qq ffmpeg\npip install --quiet pillow\n"

def exprs(text):
    return re.findall(r"\$\{\{(.*?)\}\}", str(text), flags=re.S)
def steps_ok(label, steps, composite=False):
    ids = [s.get("id") for s in steps if s.get("id")]
    check(f"{label}: step ids are unique", len(ids) == len(set(ids)), ids)
    seen = set()
    for i, s in enumerate(steps):
        n = f"{label} step {i + 1} ({s.get('name') or s.get('uses') or s.get('id')})"
        check(f"{n}: only known keys", set(s) <= STEP_KEYS, set(s) - STEP_KEYS)
        check(f"{n}: exactly one of uses / run", ("uses" in s) != ("run" in s))
        if "with" in s: check(f"{n}: 'with' goes with 'uses'", "uses" in s)
        if composite and "run" in s: check(f"{n}: a run step inside an action names its shell", s.get("shell") == "bash")
        text = yaml.safe_dump(s)
        check(f"{n}: every expression is closed", text.count("${{") == text.count("}}"), text)
        for e in exprs(text):
            for sid in re.findall(r"steps\.([A-Za-z0-9_-]+)\.", e):
                check(f"{n}: step '{sid}' it reads from comes earlier", sid in seen, e)
        if s.get("uses", "").startswith("./"):
            path = os.path.join(ROOT, s["uses"], "action.yml")
            check(f"{n}: the local action exists", os.path.isfile(path), path)
        elif "uses" in s:
            check(f"{n}: the action is pinned to a version", re.fullmatch(r"actions/[a-z-]+(/[a-z]+)?@v\d+", s["uses"]) is not None, s["uses"])
        if s.get("id"): seen.add(s["id"])

files = sorted(glob.glob(ROOT + "/.github/workflows/*.yml"))
check("the four workflows are there", [os.path.basename(f) for f in files] == ["live-lookups.yml", "render-check.yml", "render-job.yml", "render-reel.yml"], files)
flows = {}
for f in files:
    name = os.path.basename(f)
    raw = open(f).read()
    check(f"{name}: no tabs", "\t" not in raw)
    try: d = yaml.safe_load(raw)
    except Exception as e: check(f"{name}: parses", False, e); continue
    flows[name] = d
    check(f"{name}: parses, with only known top-level keys", isinstance(d, dict) and set(d) <= TOP_KEYS, set(d) - TOP_KEYS if isinstance(d, dict) else d)
    check(f"{name}: says when it runs", True in d or "on" in d)       # YAML reads a bare "on" as true
    check(f"{name}: may only read the repo", d.get("permissions") == {"contents": "read"}, d.get("permissions"))
    jobs = d.get("jobs") or {}
    check(f"{name}: has jobs", bool(jobs))
    for jid, j in jobs.items():
        check(f"{name} job {jid}: only known keys", set(j) <= JOB_KEYS, set(j) - JOB_KEYS)
        check(f"{name} job {jid}: runs on GitHub's Linux machine with a time limit", j.get("runs-on") == "ubuntu-latest" and isinstance(j.get("timeout-minutes"), int))
        needs = j.get("needs", [])
        for nd in ([needs] if isinstance(needs, str) else needs): check(f"{name} job {jid}: needs '{nd}', which exists", nd in jobs)
        steps_ok(f"{name} job {jid}", j.get("steps") or [])

# ---- the action
a = yaml.safe_load(open(ROOT + "/.github/actions/render-tools/action.yml"))
check("action: is a composite action with a name and a description", a.get("runs", {}).get("using") == "composite" and a.get("name") and isinstance(a.get("description"), str))
steps_ok("action", a["runs"]["steps"], composite=True)
aids = {s.get("id") for s in a["runs"]["steps"]}
for out, spec in a.get("outputs", {}).items():
    sids = re.findall(r"steps\.([A-Za-z0-9_-]+)\.outputs", spec.get("value", ""))
    check(f"action output '{out}' comes from a step that exists", bool(sids) and set(sids) <= aids, spec)
check("action: offers source, restored, save and key", set(a.get("outputs", {})) == {"source", "restored", "save", "key"}, set(a.get("outputs", {})))
restore = [s for s in a["runs"]["steps"] if s.get("uses", "").startswith("actions/cache/restore@")]
check("action: fetching the kept copy may fail without failing the step", len(restore) == 1 and restore[0].get("continue-on-error") is True)
check("action: the kept copy is looked up by machine image, never more loosely",
      restore and restore[0]["with"]["restore-keys"].strip() == "${{ steps.key.outputs.prefix }}" and restore[0]["with"]["key"] == "${{ steps.key.outputs.key }}")
keyrun = [s for s in a["runs"]["steps"] if s.get("id") == "key"][0]["run"]
check("action: the name holds the machine image, the Python, tools.sh and ends in run number and attempt",
      all(w in keyrun for w in ["${ImageOS:-linux}-${ImageVersion:-0}", "${py}", "${hash}", "tools.sh", 'key=${prefix}${GITHUB_RUN_ID:-0}-${GITHUB_RUN_ATTEMPT:-1}']), keyrun)
check("action: tools.sh is there and is valid shell", os.system(f"bash -n {ROOT}/.github/actions/render-tools/tools.sh") == 0)

# ---- the real render job keeps today's install as its fallback, and nothing slow comes before the render
job = flows["render-job.yml"]["jobs"]["render"]["steps"]
names = [s.get("name") or s.get("uses") for s in job]
check("render job: steps in the right order", names == ["actions/checkout@v4", "actions/setup-python@v5", "Get ffmpeg and Pillow ready",
      "Install ffmpeg and Pillow", "Render and send back", "Keep the tools for next time"], names)
tools, longway, render, keep = job[2], job[3], job[4], job[5]
check("render job: the quick step may fail without failing the job", tools.get("id") == "tools" and tools.get("continue-on-error") is True and tools["uses"] == "./.github/actions/render-tools")
check("render job: a quick step that hangs is stopped well inside the job's own time limit, leaving time for the long way and the render",
      tools.get("timeout-minutes") == 4 and flows["render-job.yml"]["jobs"]["render"]["timeout-minutes"] >= 12)
check("action: a stalled fetch of the kept copy gives up after a minute", 'echo "SEGMENT_DOWNLOAD_TIMEOUT_MINS=1" >> "$GITHUB_ENV"' in keyrun)
check("render job: the long way is exactly the old install, and runs only when the quick step failed",
      longway.get("run") == LONG_WAY and longway.get("if") == "${{ steps.tools.outcome != 'success' }}", longway)
check("render job: the render step is as it was", render.get("run") == "bash render/run_job.sh" and set(render.get("env", {})) == {"JOB_ID", "APP_URL", "RENDER_SECRET"} and "if" not in render)
check("render job: keeping the copy comes last, can't fail the job, and only for a fresh working copy",
      keep["uses"] == "actions/cache/save@v5" and keep.get("continue-on-error") is True and keep.get("if") == "${{ !cancelled() && steps.tools.outputs.save == 'yes' }}"
      and keep["with"] == {"path": "~/render-tools", "key": "${{ steps.tools.outputs.key }}"}, keep)
check("render job: the secret is given to the render step only", sum("RENDER_SECRET" in yaml.safe_dump(s) for s in job) == 1)
old = yaml.safe_load(os.popen(f"git -C {ROOT} show d576d40:.github/workflows/render-job.yml").read())
check("render job: started the same way as before (same inputs, same permissions, same time limit)",
      old[True] == flows["render-job.yml"][True] and old["permissions"] == flows["render-job.yml"]["permissions"]
      and old["jobs"]["render"]["timeout-minutes"] == flows["render-job.yml"]["jobs"]["render"]["timeout-minutes"])
check("render job: the old install step was exactly the long way kept now", old["jobs"]["render"]["steps"][2]["run"] == LONG_WAY)

# ---- the self-check sets up the same way as the real job
chk = flows["render-check.yml"]
on = chk[True]
check("self-check: runs by hand, on changes to the renderer on main, and twice a week",
      set(on) == {"workflow_dispatch", "push", "schedule"} and on["push"] == {"branches": ["main"], "paths": ["render/**", ".github/**"]}
      and len(on["schedule"]) == 1 and re.fullmatch(r"\d+ \d+ \* \* \d,\d", on["schedule"][0]["cron"]) is not None, on)
strip = lambda s: {k: v for k, v in s.items() if k != "name"}
for q in ["quick1", "quick2", "compare"]:
    st = chk["jobs"][q]["steps"]
    mine = [strip(s) for s in st if s.get("name") != "Note the time"][:4]
    check(f"self-check job {q}: sets up exactly like the real job", mine == [strip(s) for s in job[:4]], mine)
    k = [s for s in st if s.get("name") == "Keep the tools for next time"]
    check(f"self-check job {q}: keeps the copy the same way as the real job", len(k) == 1 and strip(k[0]) == strip(keep))
check("self-check: the long-way job installs exactly as before", LONG_WAY in chk["jobs"]["long"]["steps"][2]["run"])
check("self-check: second quick run waits for the first, and the comparison for all three",
      chk["jobs"]["quick2"]["needs"] == "quick1" and chk["jobs"]["compare"]["needs"] == ["long", "quick1", "quick2"])
ups = {j: [s["with"]["name"] for s in chk["jobs"][j]["steps"] if s.get("uses", "").startswith("actions/upload-artifact@")] for j in ["long", "quick1", "quick2"]}
downs = [(s["with"]["name"], s["with"]["path"]) for s in chk["jobs"]["compare"]["steps"] if s.get("uses", "").startswith("actions/download-artifact@")]
check("self-check: each job hands over its reels under its own name, and the comparison fetches all three",
      ups == {"long": ["long"], "quick1": ["quick1"], "quick2": ["quick2"]} and downs == [("long", "got/long"), ("quick1", "got/quick1"), ("quick2", "got/quick2")], (ups, downs))
check("self-check: nothing in it uses a secret", "secrets." not in open(ROOT + "/.github/workflows/render-check.yml").read())

print("PASS" if not fails else "FAIL (%d): %s" % (len(fails), "; ".join(fails)))
sys.exit(1 if fails else 0)
