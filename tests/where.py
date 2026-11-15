"""Where the tests run. Everything comes from the environment, so nothing is tied to one machine:

  STUDIO_PORT   port of the stand-in server the tests start (default 8787)
  STUDIO_URL    its address (default http://localhost:<port>)
  STUDIO_OUT    folder for screenshots, logs and scratch files (default /tmp/studio-tests)
  STUDIO_MEDIA  folder with the sample media made by tests/make_media.sh (default <STUDIO_OUT>/media)

The tests read these as _W.URL, _W.OUT and so on. tests/serve and tests/stop read the same four names."""
import os, re

HERE = os.path.dirname(os.path.abspath(__file__))        # the tests folder
ROOT = os.path.dirname(HERE)                             # the repo
_given = os.environ.get("STUDIO_URL", "").rstrip("/")
_port = re.search(r":(\d+)$", _given)
PORT = int(os.environ.get("STUDIO_PORT") or (_port.group(1) if _port else 8787))
URL = _given or f"http://localhost:{PORT}"
HOST = URL.split("://", 1)[-1]
# A second server on the next port, for the few tests that compare with the code as it once was.
PORT2 = PORT + 1
HOST2 = f"localhost:{PORT2}"
URL2 = f"http://{HOST2}"
OUT = os.environ.get("STUDIO_OUT", "/tmp/studio-tests").rstrip("/")
MEDIA = os.environ.get("STUDIO_MEDIA", OUT + "/media").rstrip("/")
for _d in ("shots", "work"):
    os.makedirs(os.path.join(OUT, _d), exist_ok=True)
