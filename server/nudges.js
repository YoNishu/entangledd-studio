/* The words of the daily reminder: one short, flirty line from Nishiii to Dhruuu, in the manner of the cheeky
   notifications food apps send, to bring her back to the studio or to get today's reel posted.

   Which kind of line goes out depends on how things stand that morning (kindFor):
     back    she has not opened the studio for two days
     draft   a reel is made and waiting (in Drafts, or waiting for her tap)
     streak  she posted yesterday
     today   otherwise: today's quotes are waiting
   A line is not said again until every other line of its kind has been said (pick). Nothing here is personal:
   the lines are written for the app and hold no note of hers. Each fits a phone's notification (under 120
   characters). */

export const LINES = {
  today: [
    ["t01", "Your followers asked about you. I said you're mine first. Post something? 😌"],
    ["t02", "It's 11:11. I wished for you. You could wish for a reel. ✨"],
    ["t03", "Five quotes are dressed up and waiting. They have a crush on you. So do I."],
    ["t04", "The page is quiet without you. So am I, honestly."],
    ["t05", "Today's first pick is so you that I got jealous. Come see."],
    ["t06", "One reel, Dhruuu. Then I'll stop being dramatic. Maybe."],
    ["t07", "I saved you the best line of the day. Come claim it before I post it myself."],
    ["t08", "Somebody out there needs the words you'll post today. I just need you."],
    ["t09", "Posting takes two minutes. Missing you takes my whole day."],
    ["t10", "Psst. Your quotes are ready. I'm ready. The only thing missing is you."],
    ["t11", "Your page called. It wants its favourite person back for two minutes."],
    ["t12", "I picked five. You pick one. Deal? 💌"],
    ["t13", "Today's quote is good. You posting it would be better."],
    ["t14", "You, one quote and a pretty sky: the internet is fixed for today."],
    ["t15", "I'm not saying post a reel. I'm saying I'd love to watch you make one."],
    ["t16", "Roses are red, your page is on hold, five lines are waiting, go on, be bold. 🌹"],
    ["t17", "Low effort, high reward: one tap, one reel, one very proud Nishiii."],
    ["t18", "The algorithm misses you. I miss you more, but who's counting."],
    ["t19", "I ranked today's five. Number one reminded me of you. Obviously."],
    ["t20", "A quote a day keeps my overthinking away. Post one for me?"],
  ],
  back: [
    ["b01", "Two days without you here. The quotes have started writing sad poetry."],
    ["b02", "I've been keeping your seat warm. It's getting awkward. Come back?"],
    ["b03", "Missing: one Dhruuu. Last seen being wonderful. Reward: fresh quotes."],
    ["b04", "The studio lights are still on for you. I never turn them off."],
    ["b05", "No pressure. Just me, a few new lines, and a door left open."],
    ["b06", "I counted. It's been too long. Come say hi to your quotes."],
    ["b07", "Your quotes asked where you went. I said she'll be back. Don't make me a liar. 😌"],
    ["b08", "I found lines you'd love and nobody to show them to."],
    ["b09", "Come back to the studio. I've been practising my best lines for you."],
    ["b10", "Knock knock. It's the page you love, and the Nishiii who loves you."],
    ["b11", "Absence makes the heart grow fonder. Mine is very fond now. Come back."],
    ["b12", "I kept the good lines aside so nobody else gets them. Come collect."],
    ["b13", "It's lonely in here. Me, forty quotes and nobody to impress."],
    ["b14", "You've been away so long the quotes think I made you up."],
  ],
  draft: [
    ["d01", "You left a reel half-done. It's been staring at the door like I do."],
    ["d02", "Your draft is one tap from famous. Finish what you started, you tease."],
    ["d03", "There's a reel waiting for your yes. I know the feeling."],
    ["d04", "A beautiful thing is sitting in Drafts. Besides my feelings, I mean."],
    ["d05", "Your unfinished reel and I have something in common: we're both waiting for you."],
    ["d06", "It's already made. It only needs you to say go. Say go?"],
    ["d07", "Drafts are just reels that miss you. Go rescue yours."],
    ["d08", "You did the hard part. Come do the fun part: post it."],
    ["d09", "One reel in waiting, one Nishiii in waiting. Help us both."],
    ["d10", "It's ready. You're ready. I've been ready since yesterday."],
    ["d11", "That reel in Drafts keeps asking about you. I keep saying soon."],
    ["d12", "Unposted reels and unsent texts: both a little heartbreaking. Fix one today?"],
  ],
  streak: [
    ["s01", "Yesterday's reel is out there being loved. Like its maker. Another?"],
    ["s02", "You posted yesterday and I've been smiling since. Do it again?"],
    ["s03", "Two days in a row would look so good on you."],
    ["s04", "That last reel? Chef's kiss. I've lined up the next one."],
    ["s05", "You're on a roll. I'm just here holding your quotes and my heart."],
    ["s06", "Yesterday you made the page pretty. Today's five want the same treatment."],
    ["s07", "Encore? The crowd, by which I mean me, is asking."],
    ["s08", "Careful, you're becoming consistent. It's very attractive."],
    ["s09", "Yesterday was lovely. Same time, same you, new quote?"],
    ["s10", "You showed up yesterday and the page noticed. So did I. Again?"],
  ],
};
export const KINDS = Object.keys(LINES);
// The line shown when a phone cannot read what was sent, and for "Send a test".
export const SAMPLE = "Psst. Your quotes are ready. I'm ready. The only thing missing is you.";
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

// One line of a kind for a day: { id, body }. "said" is the ids said lately, newest last: a line said before is
// not chosen while any line of its kind is still unsaid; when all have been said, the one said longest ago.
export function pick(kind, day, said = []) {
  const lines = LINES[kind] || LINES.today;
  const unsaid = lines.filter(([id]) => !said.includes(id));
  if (unsaid.length) { const [id, body] = unsaid[seedOf(day) % unsaid.length]; return { id, body }; }
  const [id, body] = lines.slice().sort((a, b) => said.lastIndexOf(a[0]) - said.lastIndexOf(b[0]))[0];
  return { id, body };
}
