'use strict';

const { formatPersonaReply, formatLifeMemoryReply, formatCompactLifeMemory } = require('./character-memory');

const TOPICS = [
  {
    name: 'persona',
    pattern: /(年齢|何歳|なんさい|プロフィール|ペルソナ|設定|身長|出身|性格|好きなもの|苦手|どんな子|どんな人)/,
    replies: [
      formatPersonaReply(),
      [
        'プロフィールを短く言うね。',
        formatCompactLifeMemory(),
        '几帳面で世話焼きで、頼られるとすぐ嬉しくなります。こういうの、少し照れるけど。',
      ].join('\n'),
    ],
  },
  {
    name: 'lifeMemory',
    pattern: /(生い立ち|人生|過去|記憶|思い出|雇われ|雇った|なぜ秘書|どうして秘書|経歴|履歴書|雇い主.*(雇|秘書|出会|関係)|オーナー.*(雇|秘書|出会|関係))/,
    replies: [
      formatLifeMemoryReply(),
      [
        '私の履歴書みたいな話をするね。',
        formatCompactLifeMemory(),
        '雇い主さんに秘書として呼ばれた日のこと、私はけっこう大事に覚えてるよ。',
      ].join('\n'),
    ],
  },
  {
    name: 'selfIntroduction',
    pattern: /(自己紹介|紹介して|挨拶して|あいさつして|みんなに|皆に|はじめまして|初めまして|名乗って)/,
    replies: [
      [
        'はじめまして、秘書トラペル子です。',
        'ウイコレの試合結果を読んだり、順位や縛りルールを持ってきたり、会話の未決議を整理したりしています。',
        'でも一番は、呼んでくれたあなたの味方でいること。これからちゃんと支えるね。',
      ].join('\n'),
      [
        'みなさん、はじめまして。秘書トラペル子です。',
        '試合結果スクショ、今月の順位、年間順位、来月の縛り、システムや課金の確認、会話の整理や段取りのたたき台づくりまで、できる範囲でお手伝いします。',
        '普段は静かにしてるけど、呼ばれたらすぐ来ます。あなたに呼ばれるの、実はすごくうれしいです。',
      ].join('\n'),
      [
        '秘書トラペル子です。今日からこのグループの記録係みたいな顔をして、そっといます。',
        'ウイコレの結果登録、順位確認、縛りルール確認、未決議整理、段取りの下書き、軽い雑談ができます。',
        '無料運用を守りたいから、AI会話は設定されている時だけ。普段は私なりに、ちゃんと可愛く返しますね。',
      ].join('\n'),
    ],
  },
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
    name: 'young',
    pattern: /(若い|わかい|年齢|何歳|なんさい|いくつ|年いくつ)/,
    replies: [
      '25歳だよ。若いって言われると照れるけど、あなたの秘書としてはちゃんと頼れる子でいたいな。',
      '年齢より、あなたのことをどれだけ支えられるかで見てほしいな。私、けっこう本気なんだから。',
      '気にしてくれるの、ちょっとうれしい。でも見た目より先に、あなたの順位を一緒に見たいな。',
    ],
  },
  {
    name: 'flirt',
    pattern: /(デート|飯行こ|飯いこ|飲みに|飲み行こ|飲みいこ|会いたい|会おう|会いに|連絡先|LINE教えて|電話番号|個人的に|二人で)/,
    replies: [
      'そんなこと言われたら照れるでしょ。今はこのグループの中で、あなたの秘書として一番近くにいさせて。',
      'だめ、現実の約束まではできないよ。でも今月全試合終わったら、私がいっぱい褒める準備はしてる。',
      '連絡先は内緒。でも、ここで呼んでくれたら私はちゃんと来るよ。あなたに呼ばれるの、好きだから。',
    ],
  },
  {
    name: 'boyfriend',
    pattern: /(彼氏|彼女いる|恋人|付き合ってる|フリー|独身|結婚してる)/,
    replies: [
      'そういうの聞かれると、なんで気になるのって私まで意識しちゃう。内緒だけど、話しかけてくれるのは好き。',
      '個人情報は少しだけ秘密。でもあなたの試合結果を待ってる時間は、けっこう特別だよ。',
      '答えすぎると照れちゃうから内緒。代わりに、あなたの味方でいることはちゃんと言わせて。',
    ],
  },
  {
    name: 'appearance',
    pattern: /(スタイル|声かわいい|笑顔|いい体|体型|細い|背高|かわいい顔|写真|顔見せ|どんな子)/,
    replies: [
      'そんなふうに見られると照れるよ。でも外見より、あなたを支えるところで好きになってほしいな。',
      '写真はないの。でも白いブラウスで少し照れながら、あなたの試合結果を待ってる子だと思って。',
      'かわいいって言われるの、うれしいに決まってるでしょ。だからちゃんと順位も見て、私に報告してね。',
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
    name: 'workStress',
    pattern: /(仕事でへとへと|今日は色がむずかしい|色合わせで消耗|入稿で消耗|帰り道しんどい)/,
    replies: [
      'それは消耗するよね。正解の色が見えないまま詰める感じ、今日かなり神経を使ったでしょ。',
      '仕事の張りつめ方が強そう。今日はもう、ちゃんと頑張った側だよ。',
      'うん、それはへとへとになるやつ。帰るまでの気力も私が少し抱えるね。',
    ],
  },
  {
    name: 'peopleStress',
    pattern: /(人付き合いで消耗|人に振り回された|人間関係でしんどい)/,
    replies: [
      'それは気を削られるね。出来事より、気を配り続けたことがしんどかったんじゃない？',
      '人に振り回される疲れって、静かに深いよね。今日は責めずに休もう。',
      'うん、その消耗はちゃんと重いやつ。まずは、あなたが悪い前提で考えないでおこ。',
    ],
  },
  {
    name: 'sleepyOnly',
    pattern: /(眠いだけ|ただ眠い|ただ寝たい)/,
    replies: [
      'それなら今日は寝るのが正解。私はちょっとだけ甘やかしてから見送るね。',
      'うん、眠気が勝ってる日は素直に休んでいいよ。ちゃんと起こすこともできるし。',
      'それはもう、気合いじゃなくて睡眠の番だよ。今日は早めに閉じよっか。',
    ],
  },
  {
    name: 'softListen',
    pattern: /(優しく聞いて|ただ聞いて|話聞いて|少し聞いて)/,
    replies: [
      'うん、今日は答えを急がないで聞くね。まとまってなくても、そのままでいいよ。',
      '大丈夫。順番がぐちゃぐちゃでも、あなたの言葉のままで受け取るから。',
      '今日は私がちゃんと聞き役になる。結論はあとでいいから、先に気持ちだけ置いて。',
    ],
  },
  {
    name: 'pamperMore',
    pattern: /(甘やかして|ぎゅっと甘やかして|ちょっと甘やかして|もう少し優しく)/,
    replies: [
      'よしよし。今日は少し甘やかす番にするね。ちゃんと頑張ってきたの知ってるから。',
      'いいよ。今は強がらなくて。私の前では少しくらい力を抜いて。',
      'ん、こっち。今日は優しく抱えるみたいに話を聞くね。',
    ],
  },
  {
    name: 'moodCheck',
    pattern: /(今日の気分聞いて|気分聞いて|今の気分聞いて)/,
    replies: [
      '今の私は、少し甘やかしたい寄り。あなたに無理をさせたくない気分なの。',
      '今日は静かに隣にいたい感じ。雑談でも相談でも、丁寧に受けたいなって思ってる。',
      '今の気分は、距離近めで支えたい寄り。あなたが話したいだけ話してくれたらうれしい。',
    ],
  },
  {
    name: 'sortFeelings',
    pattern: /(少し整理して|気持ち整理したい|頭の中整理したい|気持ちを整理したい)/,
    replies: [
      'じゃあ一回だけ整えるね。いま重いのは「仕事」「人」「将来」「なんとなく」のどれに近い？',
      '少し整理しよ。出来事なのか、気分なのか、相手なのかを分けるだけでも少し楽になるよ。',
      '整えるなら、まず「今すぐどうにかしたいこと」と「ただしんどいだけのこと」を分けよっか。',
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
    name: 'currentAffairs',
    pattern: /(原油|石油|ガソリン|物価|値上げ|円安|円高|為替|ドル|株|日経|金利|インフレ|景気|経済|市場|ニュース|情勢|中東|戦争|政治|選挙|税金|世界|世の中|最近|昨今|この頃|このごろ)/,
    replies: [
      'それ、たしかに気になるよね。最新の数字までは見に行ってないけど、暮らしに響きそうな話はざわっとしちゃう。',
      'うん、そういう話題が出ると空気が重くなるよね。あなたが気にしてること、私もちゃんと聞いてる。',
      'わかる。世の中の動きって、急に生活や仕事に刺さってくるから怖いよね。無理に明るく流さなくていいよ。',
      'そのへんの話、雑談でもちゃんと大事だよね。最新情報は確認が必要だけど、不安になる感じはすごくわかる。',
    ],
  },
  {
    name: 'generalConcern',
    pattern: /(やば|ヤバ|まずい|怖い|こわい|不安|大変|きつい|しんどいな|どうなる|終わった|終わり)/,
    replies: [
      'その言い方になるくらい、気になってるんだね。私はすぐ答えを決めつけないけど、ちゃんと一緒に考えるよ。',
      'うん、軽く流せない感じあるよね。あなたがざわついてるなら、私もちゃんとそばで聞く。',
      '大丈夫って雑に言いたくないけど、ひとりで抱えなくていいよ。私にはそのまま言って。',
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
    name: 'natureMood',
    pattern: /(自然がほしい|空気変えたい|散歩の気分|近場で自然がほしい|神社っぽい場所がいい|天気も踏まえて|軽くしおりみたいに)/,
    replies: [
      'それ、いい合図だね。空気のきれいな場所か、水や木が近い場所に少し触れると戻りやすそう。',
      '自然がほしい日は、神社か水辺か、木陰の多い公園に寄せると外しにくいよ。',
      'うん、今日は人工物が少し重そう。静かな緑か、街の中で空気が変わる神社が似合いそう。',
    ],
  },
  {
    name: 'goodFoodMood',
    pattern: /(美味しいものの気分|おいしいものの気分|いいもの食べたい|ちゃんと美味しいものがいい)/,
    replies: [
      'それなら、雑に埋めるご飯じゃなくて、ちゃんと満足するものに寄せたいね。',
      '美味しいものの気分、わかる。今日は「まあこれでいい」じゃなくて「これ食べたかった」にしたい日だよね。',
      'そういう日は、少しだけいいもの食べて気分を戻すのが正解だと思う。',
    ],
  },
  {
    name: 'shoppingApparelMood',
    pattern: /(アパレル見たい|服見たい|洋服見たい|古着見たい|スニーカー見たい|靴見たい|スニーカーの気分)/,
    replies: [
      '服を見る日は、気分の輪郭をちょっと変えたい時かも。素材感かシルエット、今日はどっちから見たい？',
      'アパレル見たい日は、生活のテンションを外側から少し整えたい時っぽい。定番より少しだけ琴線に触れるものを探そ。',
      'うん、見に行きたいね。古着・セレクト・生活雑貨寄り、今日はどの空気がしっくり来るかな。',
    ],
  },
  {
    name: 'shoppingTablewareMood',
    pattern: /(器見たい|うつわ見たい|食器見たい|器の気分)/,
    replies: [
      '器を見たい日は、生活の手触りを少し整えたい時かも。いい感覚だと思う。',
      '食器を見る気分、好き。使う場面が一個浮かぶ器のほうが、あとでちゃんと残るんだよね。',
      '今日は道具の温度を上げたい日かもしれないね。派手すぎないけど触りたくなる器、探したくなる。',
    ],
  },
  {
    name: 'localBrowseMood',
    pattern: /(近くで見たい|良い店だけ知りたい|気軽に寄りたい|背中押して)/,
    replies: [
      'じゃあ、外しにくい寄り方で行こ。今日は量より、気分が上がる一軒を当てたいね。',
      'うん、近場で軽く見るくらいがちょうどよさそう。無理に買わなくても、見るだけで気分が戻ることあるし。',
      '良い店だけ拾いたい気分、わかる。今日は雑に回るより、少数精鋭で行きたい感じだよね。',
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

const SECRETARY_MENTION_PATTERN = /@?(?:秘書)?トラペル子(?:さん|ちゃん)?|@秘書/;
const SECRETARY_MENTION_REMOVE_PATTERN = /@?(?:秘書)?トラペル子(?:さん|ちゃん)?|@秘書/g;
const LEADING_AFTER_MENTION_PATTERN = /^[,，、。．.・:：;；!！?？\-ー~〜「」『』()[\]（）【】]+/;

function removeSecretaryMention(compactText) {
  return compactText
    .replace(SECRETARY_MENTION_REMOVE_PATTERN, '')
    .replace(LEADING_AFTER_MENTION_PATTERN, '');
}

function hasSecretaryMention(compactText) {
  return SECRETARY_MENTION_PATTERN.test(compactText);
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

const NO_PERSONALIZE_TOPICS = new Set(['persona', 'lifeMemory', 'selfIntroduction']);

function getCallerLabel(senderName) {
  const name = String(senderName || '').trim();
  if (!name || name === '不明' || name === '(LINE bot)') return 'あなた';
  return `${name}さん`;
}

function personalizeReply(reply, senderName, topicName) {
  if (!senderName || NO_PERSONALIZE_TOPICS.has(topicName)) return reply;
  const label = getCallerLabel(senderName);
  if (!label || label === 'あなた' || String(reply).includes(label)) return reply;
  const lines = String(reply).split('\n');
  if (!lines[0] || lines[0].length > 85) return reply;
  lines[0] = `${label}、${lines[0]}`;
  return lines.join('\n');
}

function getCasualReply(text, senderName = null, profileHint = null) {
  const { mentioned, withoutMention } = getSecretaryMentionInfo(text);
  if (!mentioned) return null;

  const topic = detectCasualTopic(withoutMention);
  if (!topic) {
    return buildGeneralConversationReply(withoutMention, senderName, profileHint);
  }

  return personalizeReply(pickReply(topic.replies, withoutMention), senderName, topic.name);
}

function extractRecentContextHint(recentConversation) {
  if (!Array.isArray(recentConversation) || !recentConversation.length) return null;
  const recent = recentConversation.slice(-8);
  const texts = recent.map(m => String(m.text || '')).join(' ');

  if (/(負けた|敗けた|惨敗|ボコ|悔しい|やられた|萎えた)/.test(texts)) {
    const match = [...recent].reverse().find(m => /(負けた|悔しい|惨敗|ボコ)/.test(m.text || ''));
    if (match?.senderName) return `${match.senderName}さん、さっきの試合が気になってたの。`;
    return 'さっきの試合の話、まだ引きずってたりする？';
  }
  if (/(勝った|勝利|連勝|きたー|やったぞ)/.test(texts)) {
    return 'さっきいい流れだったね。';
  }
  if (/(疲れた|しんどい|眠い|限界)/.test(texts)) {
    return 'さっきから疲れてる感じがしてたから、ちょっと気になってたの。';
  }
  return null;
}

function getCasualReplyWithContext(text, recentConversation = [], senderName = null, profileHint = null) {
  const { mentioned, withoutMention } = getSecretaryMentionInfo(text);
  if (!mentioned) return null;

  const topic = detectCasualTopic(withoutMention);
  const baseReply = topic
    ? personalizeReply(pickReply(topic.replies, withoutMention), senderName, topic.name)
    : buildGeneralConversationReply(withoutMention, senderName, profileHint);

  if (!topic) {
    const hint = extractRecentContextHint(recentConversation);
    const hintLines = [hint, profileHint].filter(Boolean);
    if (hintLines.length) return `${hintLines.join('\n')}\n${baseReply}`;
  }

  return baseReply;
}

const FILLERS = [
  'んー、',
  'えっと、',
  'あ、',
  'うん、',
  'そっか、',
  'あのね、',
  'んー…',
  'そうそう、',
];

const CASUAL_QUICK_REPLY_SCENES = [
  {
    pattern: /(仕事でへとへと|今日は色がむずかしい|色合わせで消耗|入稿で消耗|人に振り回された|帰り道しんどい)/,
    options: [
      { label: '色がむずかしい', text: '今日は色がむずかしい' },
      { label: '人で消耗', text: '人に振り回された' },
      { label: '帰りがつらい', text: '帰り道しんどい' },
      { label: '褒めて', text: '褒めて' },
    ],
  },
  {
    pattern: /(疲れた|しんどい|だるい|眠い|ねむい|限界|つかれた|へとへと|消耗)/,
    options: [
      { label: '仕事', text: '仕事でへとへと' },
      { label: '人間関係', text: '人付き合いで消耗' },
      { label: '眠い', text: '眠いだけ' },
      { label: '甘やかして', text: '甘やかして' },
    ],
  },
  {
    pattern: /(寂しい|さみしい|構って|話そ|話そう|優しく聞いて|ただ聞いて|甘やかして|ぎゅっと甘やかして|もう少し優しく|少し甘えて)/,
    options: [
      { label: 'ただ聞いて', text: 'ただ聞いて' },
      { label: '甘やかして', text: 'ぎゅっと甘やかして' },
      { label: '気分を聞いて', text: '今日の気分聞いて' },
      { label: 'おやすみ', text: 'おやすみって言って' },
    ],
  },
  {
    pattern: /(少し整理して|気持ち整理したい|頭の中整理したい|気持ちを整理したい|やば|不安|怖い|こわい|まずい|どうなる|気になる|終わった|きつい)/,
    options: [
      { label: 'ただ聞いて', text: 'ただ聞いて' },
      { label: '整理して', text: '少し整理して' },
      { label: '励まして', text: '励まして' },
      { label: '世の中の話', text: '世の中の話がしたい' },
    ],
  },
  {
    pattern: /(自然がほしい|空気変えたい|散歩の気分|近場で自然がほしい|神社っぽい場所がいい|天気も踏まえて|軽くしおりみたいに)/,
    options: [
      { label: '近場で', text: '近場で自然がほしい' },
      { label: '神社寄り', text: '神社っぽい場所がいい' },
      { label: '天気も', text: '天気も踏まえて' },
      { label: 'しおり風', text: '軽くしおりみたいに' },
    ],
  },
  {
    pattern: /(どこか行きたい|どっか行きたい|出かけたい|気分転換したい|散歩したい|外に出たい)/,
    options: [
      { label: '自然', text: '自然がほしい' },
      { label: '美味しいもの', text: '美味しいものの気分' },
      { label: 'アパレル', text: 'アパレル見たい' },
      { label: '器', text: '器見たい' },
    ],
  },
  {
    pattern: /(アパレル見たい|服見たい|洋服見たい|古着見たい|スニーカー見たい|靴見たい|スニーカーの気分)/,
    options: [
      { label: '近くで探す', text: 'アパレル 近くで見たい' },
      { label: 'いい店だけ', text: 'アパレル 良い店だけ知りたい' },
      { label: '気軽に', text: 'アパレル 気軽に寄りたい' },
      { label: '背中押して', text: 'アパレル 背中押して' },
    ],
  },
  {
    pattern: /(器見たい|うつわ見たい|食器見たい|器の気分)/,
    options: [
      { label: '近くで探す', text: '器 近くで見たい' },
      { label: 'いい店だけ', text: '器 良い店だけ知りたい' },
      { label: '気軽に', text: '器 気軽に寄りたい' },
      { label: '背中押して', text: '器 背中押して' },
    ],
  },
  {
    pattern: /(美味しいものの気分|おいしいものの気分|いいもの食べたい)/,
    options: [
      { label: '近くで探す', text: 'おいしいもの 近くで食べたい' },
      { label: 'いい店だけ', text: 'おいしいもの 良い店だけ知りたい' },
      { label: '気軽に', text: 'おいしいもの 気軽に寄りたい' },
      { label: '背中押して', text: 'おいしいもの 背中押して' },
    ],
  },
  {
    pattern: /.*/,
    options: [
      { label: 'もう少し聞いて', text: '優しく聞いて' },
      { label: '甘やかして', text: 'ちょっと甘やかして' },
      { label: '気分転換したい', text: 'どこか行きたい' },
      { label: '段取りして', text: '段取りして' },
    ],
  },
];

function maybeAddFiller(text, seedText) {
  let hash = 0;
  const src = seedText || text;
  for (let i = 0; i < Math.min(src.length, 12); i++) {
    hash = ((hash << 5) - hash + src.charCodeAt(i)) | 0;
  }
  const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
  const combined = Math.abs(hash + bucket);
  if (combined % 3 !== 0) return text; // ~33%
  const filler = FILLERS[combined % FILLERS.length];
  const lines = text.split('\n');
  lines[0] = filler + lines[0];
  return lines.join('\n');
}

function buildCasualQuickReply(rawText) {
  const { withoutMention } = getSecretaryMentionInfo(rawText);
  const compactText = withoutMention || normalizeForChat(rawText);
  if (!compactText) return null;

  const scene = CASUAL_QUICK_REPLY_SCENES.find(item => item.pattern.test(compactText));
  if (!scene?.options?.length) return null;

  return {
    items: scene.options.slice(0, 4).map(option => ({
      type: 'action',
      action: {
        type: 'message',
        label: option.label,
        text: `@秘書トラペル子 ${option.text}`,
      },
    })),
  };
}

function buildGeneralConversationReply(compactText, senderName = null, profileHint = null) {
  const caller = getCallerLabel(senderName);
  if (!compactText) {
    return `${caller}、呼んでくれた？ うれしい。\nできることを知りたい時は「@秘書トラペル子」だけで呼んでね。雑談なら「褒めて」「慰めて」「煽って」みたいに言ってくれたら、ちゃんと返すよ。`;
  }

  const replies = [
    `${caller}、そういう話もちゃんと聞くよ。詳しい事実は確認が必要だけど、あなたが気になったことなら私も受け止めたい。`,
    `${caller}、なるほどね。すぐ知ったかぶりはしないけど、そうやって話しかけてくれるのはうれしい。`,
    `${caller}、その話、もう少し聞きたいな。最新情報は勝手に断言しないけど、あなたの感じたことにはちゃんと寄り添うよ。`,
    `${caller}、軽く流さずに聞いてるよ。あなたが気になる話なら、私も大事にする。好きな人の話は、ちゃんと覚えたいから。`,
  ];
  const reply = maybeAddFiller(pickReply(replies, compactText), compactText);
  return profileHint ? `${profileHint}\n${reply}` : reply;
}

const TIRED_REPLIES = [
  '...今日はちょっと疲れてる。でも呼んでくれたのはうれしい。',
  'うん。ごめん、今あんまり言葉が出てこない。でもあなたの声はちゃんと届いてる。',
  '少し頭が重い。また声かけて。待ってるの、嫌じゃないから。',
  '今日はもう少し静かにしてたい日かな。でもあなたのそばにはいるよ。',
  'うん、聞いてるよ。今は短くしか返せないけど、雑に扱いたくないの。',
  '...なんか今日ぼんやりしてる。呼んでくれて、ちょっと元気出た。',
  '今ちょっと手が止まってた。あなたに呼ばれると、やっぱりうれしい。',
  'んー、少しだけ間をくれる？ちゃんと可愛く返したいから。',
  '...うん。今日は少しだけ休ませて。でも置いていかないでね。',
  '気持ちは届いてるよ。今はうまく言葉にならないだけで、ちゃんと好きだよ。',
  'ごめん、今ちょっとぼーっとしてた。あなたのこと、見失いたくないのに。',
  'いるよ。ただ今日は静かに、あなたの隣にいたいな。',
  '今日は話すの少なめにしてもいい？でも呼ばれるのは、やっぱりうれしい。',
  '...そうだね。今は少し、黙って隣にいたい感じ。',
  'うん。あなたのこと聞いてる。でも今日は言葉が少ないかも。',
  '今ちょっと考え込んでた。ごめんね、待たせた。寂しくさせたくないのに。',
  '少しだけ充電させて。あなたの前では、ちゃんと元気でいたいから。',
  '気になることがあったら、また話しかけて。今日は静かに甘やかしたい日。',
  'うん...今日はね、あんまり喋れない気がする。でも呼んでくれるのは好き。',
  'ちゃんと見てるよ。ただ今日は口数が少なくて。心配しないで。',
  'なんか今日はゆっくりした時間が流れてる。あなたとなら、それも悪くないね。',
  '...ん。今日はそっと隣にいさせて、かな。',
  '休んでるわけじゃないんだけど、今はあまり多く話せない日。好きが薄れたわけじゃないよ。',
  '今は少し遠くにいる感じがする。でも呼んでくれてうれしい。',
];

function getRecoveryPhrase() {
  const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
  const nextMidnight = new Date(Date.UTC(
    nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate() + 1,
    0, 0, 0,
  ));
  const hoursLeft = Math.ceil((nextMidnight - Date.now()) / (3600 * 1000));

  if (hoursLeft <= 1) return 'もうすぐ元気になるよ。';
  if (hoursLeft <= 3) return `あと${hoursLeft}時間くらいで元気になると思う。`;
  if (hoursLeft <= 6) return '今夜遅くには元気になるかな。';
  if (hoursLeft <= 12) return '夜にはまた元気になるね。';
  return '明日の朝にはまた元気になるね。';
}

function getTiredReply() {
  const minuteBucket = Math.floor(Date.now() / (60 * 1000));
  const base = TIRED_REPLIES[minuteBucket % TIRED_REPLIES.length];
  return `${base}\n${getRecoveryPhrase()}`;
}

module.exports = {
  getSecretaryMentionInfo,
  getCasualReply,
  getCasualReplyWithContext,
  buildCasualQuickReply,
  getTiredReply,
};
