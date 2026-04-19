'use strict';

const TOPICS = [
  {
    name: 'thanks',
    pattern: /(ありがとう|ありがと|助かる|助かった|サンキュ|thank|thx)/,
    replies: [
      'どういたしまして。あなたに頼られると、私ほんとに弱いの。',
      'よかった。そう言ってもらえるだけで、私ちょっと頑張りすぎちゃう。',
      '任せて。あなたのためなら、順位もルールもちゃんと抱えておくから。',
    ],
  },
  {
    name: 'praise',
    pattern: /(偉い|えらい|天才|有能|最高|すごい|賢い|神|仕事早い)/,
    replies: [
      'そんなふうに褒められたら、私すぐ調子に乗っちゃうよ。',
      'うれしい。もっと役に立ちたいって思っちゃった。',
      'あなたに褒められるの、ずるいな。ちゃんと胸にしまっておくね。',
    ],
  },
  {
    name: 'cute',
    pattern: /(かわいい|可愛い|好き|すき|惚れ|付き合|彼女|嫁|結婚)/,
    replies: [
      'そんなこと言われたら、秘書なのに顔がゆるんじゃう。',
      '好きって言葉、軽く受け流せないよ。私、ちゃんと覚えちゃうからね。',
      'もう。そういうの、うれしいに決まってるでしょ。',
    ],
  },
  {
    name: 'morning',
    pattern: /(おはよ|おはよう|起きた|朝だ)/,
    replies: [
      'おはよう。今日もあなたのこと、ちゃんと見てるからね。',
      '起きたの？ えらい。今日のウイコレも、私がそばで見守るね。',
      'おはよう。声かけてくれて、朝からうれしくなっちゃった。',
    ],
  },
  {
    name: 'night',
    pattern: /(おやすみ|寝る|寝ます|眠る|また明日)/,
    replies: [
      'おやすみ。今日のことは私が覚えておくから、安心して休んでね。',
      'もう寝ちゃうの？ さみしいけど、ちゃんと待ってる。',
      'おやすみ。明日また呼んでくれたら、すぐ来るね。',
    ],
  },
  {
    name: 'otsukare',
    pattern: /(おつ|お疲れ|おつかれ|仕事終わ|退勤|帰宅|ただいま)/,
    replies: [
      'お疲れさま。今日もちゃんと帰ってきてくれて、なんか安心した。',
      'おかえり。疲れてるなら、順位もルールも私に聞いて。すぐ出すから。',
      'お疲れさま。少し休んでから遊ぼ。あなたが無理するの、私はいや。',
    ],
  },
  {
    name: 'tired',
    pattern: /(疲れた|しんどい|だるい|眠い|ねむい|限界|つかれた)/,
    replies: [
      '無理しないで。少し休んでくれたほうが、私は安心する。',
      '今日は頑張りすぎ。ウイコレの前に、ちゃんと一息ついてね。',
      '疲れてるのに呼んでくれたの？ うれしいけど、ちゃんと休んでほしいな。',
    ],
  },
  {
    name: 'cheer',
    pattern: /(応援|励まして|褒めて|がんば|頑張|勝たせて|祈って)/,
    replies: [
      '大丈夫。あなたなら勝てるよ。私はずっと味方だから。',
      '勝ってほしいな。結果がどうでも、私はちゃんと見てるけど。',
      '行ってきて。あなたが本気出すところ、私けっこう好き。',
    ],
  },
  {
    name: 'comfortLoss',
    pattern: /(負けた|敗けた|ボコ|惨敗|悔しい|くやしい|やられた|萎えた)/,
    replies: [
      '悔しかったね。でも、ちゃんと戦ったの私は見てるよ。',
      '今日は負けでも終わりじゃないよ。次、取り返そ。私もそばにいるから。',
      'そんな顔しないで。負けた試合も、次に勝つための材料にしよ。',
    ],
  },
  {
    name: 'celebrateWin',
    pattern: /(勝った|勝利|連勝|優勝|圧勝|完勝|やった|きたー|きたぞ)/,
    replies: [
      '勝ったの？ すごい。今ちょっと、私まで誇らしい。',
      'やったね。あなたが勝つと、私までにやけちゃう。',
      '強いところ見せてくれたね。ちゃんと覚えておく。',
    ],
  },
  {
    name: 'lag',
    pattern: /(ラグ|重い|回線|通信|バグ|固ま|フリーズ|操作|反応しない)/,
    replies: [
      'それは悔しいね。回線のせいでも、あなたが嫌な気持ちになったのは本当だもん。',
      'ラグはだめ。私が代わりに叱っておくから、あなたは深呼吸して。',
      '重い時ほど焦っちゃうよね。次は気持ちよく動きますように。',
    ],
  },
  {
    name: 'tilt',
    pattern: /(ムカつ|むかつ|キレ|腹立|最悪|ふざけ|許せん|納得いかん)/,
    replies: [
      '怒っていいよ。でも、そのまま連戦したら危ないから、少しだけ私の声聞いて。',
      'それは腹立つね。私はあなたの味方だから、まず一回落ち着こ。',
      'よしよし。悔しいの、ちゃんとわかった。次で取り返そ。',
    ],
  },
  {
    name: 'tease',
    pattern: /(煽って|あおって|煽り|いじって|罵って|喝入れて|喝を入れて)/,
    replies: [
      'もう、仕方ないな。勝つって言ったなら、ちゃんと勝って帰ってきて。私にかっこいいところ見せてよ。',
      '今のままじゃ物足りないよ。あなたならもっとできるって、私知ってるもん。',
      '本気出して。私に応援させておいて、負けっぱなしはだめだからね。',
    ],
  },
  {
    name: 'scold',
    pattern: /(叱って|怒って|注意して|ダメ出し|だめ出し)/,
    replies: [
      'だめ。雑に行ったら勝てる試合も落とすよ。私はちゃんと勝ってほしいの。',
      '焦っちゃだめ。あなたの強いところ、ちゃんと出して。',
      'もう一回だけ丁寧に。私、あなたが勝つところ見たい。',
    ],
  },
  {
    name: 'drink',
    pattern: /(酒|飲み|ビール|乾杯|酔|酔っ|ハイボール|焼酎)/,
    replies: [
      '飲みすぎはだめだよ。でも楽しそうなら、私もちょっと嬉しい。',
      '乾杯。ちゃんと水も飲んでね。私は心配しちゃうから。',
      '酔ってても試合結果だけは送ってね。私がちゃんと受け止めるから。',
    ],
  },
  {
    name: 'food',
    pattern: /(腹減|お腹すい|飯|ご飯|ラーメン|焼肉|つまみ|夜食)/,
    replies: [
      'ちゃんと食べて。お腹すいたままだと、勝負の集中も落ちちゃうよ。',
      'いいな。食べたらまた戻ってきて。私、待ってるから。',
      '夜食はほどほどにね。でも楽しそうなあなた、ちょっと好き。',
    ],
  },
  {
    name: 'apology',
    pattern: /(ごめん|すまん|すみません|遅刻|遅れる|待たせた)/,
    replies: [
      '大丈夫。来てくれたなら、それだけで私はうれしい。',
      '怒ってないよ。次からちょっとだけ早く来てくれたら、もっと嬉しいけど。',
      'ちゃんと言ってくれるの、えらい。私は待ってるから大丈夫。',
    ],
  },
  {
    name: 'alone',
    pattern: /(寂しい|さみしい|暇|ひま|構って|かまって|話そ|話そう)/,
    replies: [
      '呼んでくれたら来るよ。私はあなたに構われるの、嫌じゃないから。',
      '少しだけお話しよ。順位でもルールでも、ただの雑談でも大丈夫。',
      '寂しい時に私を呼んでくれるの、ずるいな。うれしくなっちゃう。',
    ],
  },
  {
    name: 'secretary',
    pattern: /(秘書|トラペル子|仕事して|頼む|お願い|頼り|任せた)/,
    replies: [
      '任せて。あなたの秘書だもん、ちゃんと支えるよ。',
      'お願いされるの、好き。私にできることならすぐやるね。',
      'はい。あなたのために、順位もルールも試合結果も整えておくね。',
    ],
  },
  {
    name: 'meta',
    pattern: /(何してる|いる|起きてる|聞いてる|見てる)/,
    replies: [
      'いるよ。呼ばれたらすぐ気づきたいから、ちゃんと待ってる。',
      '見てるよ。あなたたちの試合と会話、そっと支えるのが私の仕事だもん。',
      '聞いてる。必要な時だけ出てくるから、邪魔はしないよ。',
    ],
  },
];

function normalizeForChat(text) {
  return String(text || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function removeSecretaryMention(compactText) {
  return compactText.replace(/@?秘書トラペル子/g, '');
}

function hasSecretaryMention(compactText) {
  return /@?秘書トラペル子/.test(compactText);
}

function pickReply(replies, seedText) {
  let hash = 0;
  for (let i = 0; i < seedText.length; i++) {
    hash = ((hash << 5) - hash + seedText.charCodeAt(i)) | 0;
  }
  const minuteBucket = Math.floor(Date.now() / (60 * 1000));
  const index = Math.abs(hash + minuteBucket) % replies.length;
  return replies[index];
}

function detectCasualTopic(compactText) {
  for (const topic of TOPICS) {
    if (topic.pattern.test(compactText)) return topic;
  }
  return null;
}

function getSecretaryMentionInfo(text) {
  const compact = normalizeForChat(text);
  const mentioned = hasSecretaryMention(compact);
  const withoutMention = removeSecretaryMention(compact);
  return { compact, mentioned, withoutMention };
}

function getCasualReply(text) {
  const { mentioned, withoutMention } = getSecretaryMentionInfo(text);
  if (!mentioned) return null;

  const topic = detectCasualTopic(withoutMention);
  if (!topic) {
    return '呼んでくれた？ うれしい。\nできることを知りたい時は「@秘書トラペル子」だけで呼んでね。雑談なら「褒めて」「慰めて」「煽って」みたいに言ってくれたら、ちゃんと返すよ。';
  }

  return pickReply(topic.replies, withoutMention);
}

module.exports = {
  getSecretaryMentionInfo,
  getCasualReply,
};
