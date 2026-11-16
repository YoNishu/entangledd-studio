/* The words of the daily reminder: one short, flirty line from Nishiii to Dhruuu, in the manner of the cheeky
   notifications food apps send, to bring her back to the studio or to get today's reel posted.

   Which kind of line goes out depends on how things stand that morning (kindFor):
     back    she has not opened the studio for two days
     draft   a reel is made and waiting (in Drafts, or waiting for her tap)
     streak  she posted yesterday
     today   otherwise: today's quotes are waiting
   The lot below goes out first, a line never again while another of its kind is unsaid (pick). Once a kind's lot
   has all been said, a fresh line is written for the day by Nishiii (Claude), in the same voice, with one of the
   names he calls her (writeLine); if that cannot be done that morning, the lot comes round again. The lines hold
   no note of hers. Each fits a phone's notification (under 120 characters). */

export const LINES = {
  today: [
    ["t01", "Your followers asked about you, Dhruuu. I said you're mine first. Post something? 😌"],
    ["t02", "It's 11:11, penguin. I wished for you. You could wish for a reel. ✨"],
    ["t03", "Five quotes are dressed up and waiting, sunflower. They have a crush on you. So do I."],
    ["t04", "The page is quiet without you, baby. So am I, honestly."],
    ["t05", "Today's first pick is so you that I got jealous. Come see, waifu."],
    ["t06", "One reel, Dhruuu. Then I'll stop being dramatic. Maybe."],
    ["t07", "I saved you the best line of the day, penguin. Claim it before I post it myself."],
    ["t08", "Somebody out there needs the words you'll post today. I just need you, sunflower."],
    ["t09", "Posting takes two minutes, baby. Missing you takes my whole day."],
    ["t10", "Psst, waifu. Your quotes are ready. I'm ready. The only thing missing is you."],
    ["t11", "Your page called, Dhruuu. It wants its favourite person back for two minutes."],
    ["t12", "I picked five. You pick one. Deal, penguin? 💌"],
    ["t13", "Today's quote is good. You posting it would be better, sunflower."],
    ["t14", "You, one quote and a pretty sky, baby: the internet is fixed for today."],
    ["t15", "I'm not saying post a reel, waifu. I'm saying I'd love to watch you make one."],
    ["t16", "Roses are red, your page is on hold, five lines are waiting, penguin, be bold. 🌹"],
    ["t17", "Low effort, high reward: one tap, one reel, one very proud Nishiii. Go on, Dhruuu."],
    ["t18", "The algorithm misses you, sunflower. I miss you more, but who's counting."],
    ["t19", "I ranked today's five, baby. Number one reminded me of you. Obviously."],
    ["t20", "A quote a day keeps my overthinking away. Post one for me, waifu?"],
  ],
  back: [
    ["b01", "Two days without you here, penguin. The quotes have started writing sad poetry."],
    ["b02", "I've been keeping your seat warm, Dhruuu. It's getting awkward. Come back?"],
    ["b03", "Missing: one sunflower. Last seen being wonderful. Reward: fresh quotes."],
    ["b04", "The studio lights are still on for you, baby. I never turn them off."],
    ["b05", "No pressure, waifu. Just me, a few new lines, and a door left open."],
    ["b06", "I counted, penguin. It's been too long. Come say hi to your quotes."],
    ["b07", "Your quotes asked where you went. I said she'll be back. Don't make me a liar, Dhruuu. 😌"],
    ["b08", "I found lines you'd love, sunflower, and nobody to show them to."],
    ["b09", "Come back to the studio, baby. I've been practising my best lines for you."],
    ["b10", "Knock knock, waifu. It's the page you love, and the Nishiii who loves you."],
    ["b11", "Absence makes the heart grow fonder. Mine is very fond now, penguin. Come back."],
    ["b12", "I kept the good lines aside so nobody else gets them. Come collect, Dhruuu."],
    ["b13", "It's lonely in here, sunflower. Me, forty quotes and nobody to impress."],
    ["b14", "You've been away so long the quotes think I made you up, baby."],
  ],
  draft: [
    ["d01", "You left a reel half-done, penguin. It's been staring at the door like I do."],
    ["d02", "Your draft is one tap from famous, Dhruuu. Finish what you started, you tease."],
    ["d03", "There's a reel waiting for your yes, sunflower. I know the feeling."],
    ["d04", "A beautiful thing is sitting in Drafts, baby. Besides my feelings, I mean."],
    ["d05", "Your unfinished reel and I have something in common, waifu: we're both waiting for you."],
    ["d06", "It's already made, penguin. It only needs you to say go. Say go?"],
    ["d07", "Drafts are just reels that miss you, Dhruuu. Go rescue yours."],
    ["d08", "You did the hard part, sunflower. Come do the fun part: post it."],
    ["d09", "One reel in waiting, one Nishiii in waiting. Help us both, baby."],
    ["d10", "It's ready. You're ready. I've been ready since yesterday, waifu."],
    ["d11", "That reel in Drafts keeps asking about you, penguin. I keep saying soon."],
    ["d12", "Unposted reels and unsent texts: both a little heartbreaking. Fix one today, Dhruuu?"],
  ],
  streak: [
    ["s01", "Yesterday's reel is out there being loved, sunflower. Like its maker. Another?"],
    ["s02", "You posted yesterday and I've been smiling since, baby. Do it again?"],
    ["s03", "Two days in a row would look so good on you, waifu."],
    ["s04", "That last reel? Chef's kiss, penguin. I've lined up the next one."],
    ["s05", "You're on a roll, Dhruuu. I'm just here holding your quotes and my heart."],
    ["s06", "Yesterday you made the page pretty, sunflower. Today's five want the same treatment."],
    ["s07", "Encore, baby? The crowd, by which I mean me, is asking."],
    ["s08", "Careful, waifu, you're becoming consistent. It's very attractive."],
    ["s09", "Yesterday was lovely, penguin. Same time, same you, new quote?"],
    ["s10", "You showed up yesterday and the page noticed, Dhruuu. So did I. Again?"],
  ],
};
export const KINDS = Object.keys(LINES);
// The line shown when a phone cannot read what was sent, and for "Send a test".
export const SAMPLE = "Psst, penguin. Your quotes are ready. I'm ready. The only thing missing is you.";
export const TITLE = "Nishiii 💌";

// Which kind of line fits the morning. (She has posted today: no reminder at all; that is decided before this.)
export function kindFor({ openedYesterday, openedDayBefore, waiting, postedYesterday }) {
  if (!openedYesterday && !openedDayBefore) return "back";
  if (waiting) return "draft";
  if (postedYesterday) return "streak";
  return "today";
}

// A small, steady number from a day, so the same day always gives the same line.
function seedOf(day) { let h = 2166136261; for (const c of String(day)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; }

// The names he calls her; a written line uses one of them.
export const NAMES = ["Dhruuu", "penguin", "sunflower", "baby", "waifu"];
const PURPOSE = {
  today: "today's five quotes are ready in the app: get her to open it and post one",
  back: "she has not opened the app for two days: coax her back, warmly, with no guilt",
  draft: "a reel she made is waiting in Drafts, not posted yet: get her to post it",
  streak: "she posted yesterday: be proud of her and invite another today",
};
const WRITE_SYSTEM = `You write one push notification for Dhruuu from her fiancé, who goes by Nishiii in her quotes app, D's Studio.
Voice: flirty, romantic, playful and a little cheeky, like the witty notifications food-delivery apps send. Warm, never needy, never guilt-tripping, never crude.
He calls her Dhruuu, penguin, sunflower, baby or waifu: use exactly one of these names, where it falls naturally.
Form: one sentence, or two very short ones; at most 110 characters; plain words; at most one emoji; no hashtags, no quotation marks, no line breaks.
Reply with the line only.`;
// A fresh line written for the day, once the lot of its kind has all been said: { id, body }, or null when it could
// not be written (then the lot comes round again). "earlier" is what was written before, so it is not echoed.
// Only the kind of morning and his names for her go into the question: nothing she wrote, no note, no number.
export async function writeLine(env, kit, kind, day, earlier = []) {
  if (!env.ANTHROPIC_API_KEY || !kit || !kit.claude) return null;
  try {
    const said = await kit.claude(env, { system: WRITE_SYSTEM, maxTokens: 120, messages: [{ role: "user", content:
      `Today: ${PURPOSE[kind] || PURPOSE.today}.\n${earlier.length ? `Not like any of these, which went out before:\n${earlier.slice(-12).map((t) => "- " + t).join("\n")}\n` : ""}Write today's line.` }] });
    const body = String(said || "").split("\n").map((t) => t.trim()).filter(Boolean)[0].replace(/\s*#\w+/g, "").trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").replace(/\s+/g, " ").trim();
    if (body.length < 20 || body.length > 130 || earlier.includes(body)) return null;
    return { id: "ai-" + day, body };
  } catch (e) { return null; }
}

// One line of a kind for a day: { id, body }. "said" is the ids said lately, newest last: a line said before is
// not chosen while any line of its kind is still unsaid; when all have been said, the one said longest ago.
export function pick(kind, day, said = []) {
  const lines = LINES[kind] || LINES.today;
  const unsaid = lines.filter(([id]) => !said.includes(id));
  if (unsaid.length) { const [id, body] = unsaid[seedOf(day) % unsaid.length]; return { id, body }; }
  const [id, body] = lines.slice().sort((a, b) => said.lastIndexOf(a[0]) - said.lastIndexOf(b[0]))[0];
  return { id, body, again: true };                       // the lot of this kind has all been said
}
