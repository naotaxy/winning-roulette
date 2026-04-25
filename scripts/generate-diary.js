'use strict';
/**
 * 秘書トラペル子 — 日次日記生成スクリプト
 *
 * 1. YouTube Data API v3 でウイコレ関連動画を収集
 * 2. eFootball 公式 RSS でニュースを収集
 * 3. ショップアイテム紹介・音楽（週1）・90年代カルチャーをキュレーション
 * 4. Gemini で長文・人間らしい日記を生成
 * 5. はてなブログ AtomPub API で投稿
 * 6. Firebase にアーカイブ保存（Bot の知識源）
 *
 * GitHub Secrets 必要:
 *   YOUTUBE_API_KEY, GEMINI_API_KEY,
 *   HATENA_ID, HATENA_BLOG_ID, HATENA_API_KEY,
 *   FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL
 *
 * 任意:
 *   DIARY_PHOTO_URL, DIARY_PHOTO_CAPTION,
 *   DIARY_GEMINI_MODEL, DIARY_GEMINI_FALLBACK_MODELS
 */

const fs   = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// ── 環境変数 ──────────────────────────────────────────────
const {
  YOUTUBE_API_KEY,
  GEMINI_API_KEY,
  HATENA_ID,         // はてなID（例: traperuko）
  HATENA_BLOG_ID,    // ブログドメイン（例: traperuko.hatenablog.com）
  HATENA_API_KEY,    // はてな設定 → APIキー
  FIREBASE_SERVICE_ACCOUNT,
  FIREBASE_DATABASE_URL,
  DIARY_PHOTO_URL,
  DIARY_PHOTO_CAPTION,
  DIARY_GEMINI_MODEL,
  DIARY_GEMINI_FALLBACK_MODELS,
  DIARY_GROUP_SOURCE_ID, // LINEグループのsourceId（会話ハイライト取得用・任意）
} = process.env;

const BLOG_DIR = path.join(__dirname, '..', 'blog');
const DIARY_STATE_FILE = path.join(BLOG_DIR, 'diary-state.json');
const DEFAULT_DIARY_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_DIARY_GEMINI_FALLBACK_MODELS = ['gemini-2.5-flash-lite'];
const GEMINI_GENERATE_CONTENT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_RETRY_DELAYS_MS = [5000, 15000, 30000];

const WORLD_CUP_2026 = {
  startsAt: '2026-06-11',
  endsAt: '2026-07-19',
  query: 'FIFAワールドカップ 2026 サッカー 試合 結果',
};

// ── ショップ別・商品1点紹介トピック（IKEA / 百均 / UNICO / スタンダードプロダクツ）──
const SHOP_ITEM_TOPICS = [
  {
    id: 'ikea-lack-table',
    shop: 'IKEA',
    item: 'LACK ラック サイドテーブル（45×55cm・白）',
    angle: '税込499円なのに、白い天板と細い脚の美しさがある。デスクの横に置くだけでドリンクと小物の置き場が生まれて、狭い部屋でも圧迫感が出ない。',
    depth: 'LACKの天板はハニカム構造で見た目より頑丈。組み立て5分で終わる。2台並べてもサイドテーブルとして成立するし、増やして使い回せるのが強い。',
  },
  {
    id: 'ikea-skubb-organizer',
    shop: 'IKEA',
    item: 'SKUBB スカップ ボックス6ピースセット（引き出し整理用）',
    angle: '引き出しの中に仕切りがないと、いつの間にか小物が混在する。SKUBBはその問題を一発で解決する布製のボックスセット。洗えるし、引き出しのサイズに合わせられる。',
    depth: 'ケーブル・薬・メモ帳を別々のスロットに入れるだけで「探す時間」が消える。見える収納は意思決定を速くする、という話。',
  },
  {
    id: 'ikea-kallax-shelf',
    shop: 'IKEA',
    item: 'KALLAX カラックス シェルフユニット（2×2マス・白）',
    angle: '4マスのオープンシェルフ。何も置かなくてもフォルムがきれい。ボックスを入れれば収納、本を並べれば本棚、逆さにすればローボードにもなる。',
    depth: 'カラックスが長く愛用される理由は用途が固定されないから。模様替えのたびに役割を変えられる家具は少ない。買って5年後も後悔しにくい買い物の一つ。',
  },
  {
    id: 'ikea-variera-tray',
    shop: 'IKEA',
    item: 'VARIERA ヴァリエラ 引き出し用トレー（プラスチック・黒）',
    angle: 'キッチンやデスク引き出しにそのまま入れるだけ。フォーク・スプーン・文具・ケーブルが仕切りで分かれる。799円で引き出しの混乱が一気に整う。',
    depth: '使う頻度の高いものが取り出しやすい位置にある状態を意識するだけで、朝の準備が変わる。VARIERAはその入口として手が届きやすい価格帯がちょうどいい。',
  },
  {
    id: 'hyakkin-silicon-lid',
    shop: 'セリア',
    item: 'シリコン伸縮蓋（3サイズセット）',
    angle: 'ラップいらずで鍋やボウルにぴたっと被せられるシリコン蓋。セリアの110円で買えるくせに、普通に使えて普通にきれい。',
    depth: '洗いやすくて繰り返し使える。一度使うと「なぜラップを使っていたのか」と思う。小さな習慣を変える入口として、110円で試せるのがちょうどいい。',
  },
  {
    id: 'hyakkin-pp-box',
    shop: 'ダイソー',
    item: 'PPクリアボックス（A6・ふた付き）',
    angle: '薬、充電アダプタ、ケーブル類をまとめられるクリアケース。透明なので中身が見える。積み重ね可能。110円。',
    depth: '整理の第一歩は「カテゴリに名前をつけること」と言われる。このボックスに入れる行為がカテゴリ化を強制する。ものを捨てなくても整う、不思議な効果がある。',
  },
  {
    id: 'hyakkin-cable-clip',
    shop: 'ダイソー',
    item: 'ケーブルクリップ（5個入り・シリコン）',
    angle: 'デスクやテレビ周りのコードをまとめるシリコンクリップ。貼り付けタイプで剥がしても跡が残らない。移動が多い人・配置を変えやすい人ほど便利さが光る。',
    depth: 'ケーブルがまとまるだけで「作業を始めるハードル」が下がる気がする。110円の投資で集中力に関係する環境を整える話。',
  },
  {
    id: 'unico-norn-sofa',
    shop: 'UNICO',
    item: 'NORN ノルン 2Pソファ（コンパクト・グレー系）',
    angle: 'UNICOのソファの中でも座り心地と見た目のバランスがいいと評判のモデル。ファブリック素材で掃除しやすく、圧迫感が出にくいサイズ感が長所。',
    depth: 'ソファは「何をする家具か」を決めてから選ぶと失敗が減る。ゲームを長くやるなら背もたれの角度が鍵。NORNはやや浅め設計で、前傾姿勢でモニターを見ることも想定されている作りに見える。',
  },
  {
    id: 'unico-hook-rack',
    shop: 'UNICO',
    item: 'ウォールフック（アイアン・3連タイプ）',
    angle: '玄関の壁に付けるだけで、鍵・かばん・上着の置き場が生まれる。UNICOらしいシンプルでやや工業的なデザインが、素材感のある壁に映える。',
    depth: '「帰ってきたら床に置く」習慣がある人は、視線の高さにフックがないことが原因の場合が多い。壁に一本足すだけで行動パターンが変わる話。',
  },
  {
    id: 'unico-frame-tray',
    shop: 'UNICO',
    item: 'フレームトレー（アカシア材・M）',
    angle: '木の質感があるトレーをテーブルに置くと、スマホ・コップ・小物をまとめるゾーンができる。置くだけで「使う場所」と「ただ置いてある場所」が区別される。',
    depth: '部屋の整い度は「物の住所があるか」で決まる。住所がないものは気づいたら散らばる。トレーは住所を物理的に作る最小単位の道具。UNICOのは素材感が良いので飾りにもなる。',
  },
  {
    id: 'sp-canvas-tote',
    shop: 'スタンダードプロダクツ',
    item: 'キャンバストートバッグ（M・生成り）',
    angle: '550円なのに縫製がしっかりしていて、A4書類が入るちょうどいいサイズ感。メインバッグの補助として持つと出番が多い一枚。',
    depth: '「トートバッグは消耗品」と割り切ると選択肢が増える。550円なら気兼ねなく使い込める。気軽に使えるものほど日常でよく動く、という話。',
  },
  {
    id: 'sp-glass-cup',
    shop: 'スタンダードプロダクツ',
    item: 'ガラスタンブラー（250ml・真っ直ぐ型）',
    angle: '330円で、食洗器対応、余計な装飾なし。飲み物の色が透けて見えるので食卓に置くと少し映える。毎日使うものほど「好きなもの」にしたくなる、という感覚に応えてくれる一杯。',
    depth: '派手な変化ではないけど、コップを変えるだけで「今日の一杯」の質感が変わる。毎日使う器を整えることが、日常の小さな満足度を上げる最も手軽な方法だと思う。',
  },
  {
    id: 'sp-storage-box',
    shop: 'スタンダードプロダクツ',
    item: 'スタッキングコンテナ（S・グレー）',
    angle: 'シンプルなプラスチックコンテナ。棚の上に置けて、積み重ね可能。グレーで色が主張しないから、棚の中で浮かない。見せたくないものをさっと仕舞える。',
    depth: '色を揃えるだけで棚の見た目が整う。バラバラのボックスが混在すると目が休まらない。グレーで統一した棚は背景に徹するから、他のものが映えやすくなる話。',
  },
];

const MUSIC_QUERIES = [
  {
    category: 'J-POP音楽ニュース',
    query: 'J-POP 音楽ニュース 新曲 ライブ 日本',
  },
  {
    category: '日本の音楽トピック',
    query: '日本 音楽 話題 アーティスト ランキング',
  },
];

const NINETIES_TRENDS = [
  {
    id: 'eight-cm-cd',
    title: '8cm CDとCDショップの棚',
    category: '1990年代の音楽文化',
    description: '短冊みたいな8cm CDが棚に並び、ジャケットを見ながら選ぶ時間そのものが娯楽だった。',
    perspective: '25歳の私から見ると、サブスクで一瞬で聴ける今より、曲を一枚ずつ迎えに行く感じが少し羨ましい。',
  },
  {
    id: 'komuro-sound',
    title: '小室サウンドとダンス系J-POP',
    category: '1990年代の音楽文化',
    description: 'シンセの音、強いビート、テレビ番組の熱気が一体になって、街全体が同じ曲を知っているような時代だった。',
    perspective: '25歳の私には、ヒット曲が共通言語として強かった世界に見える。今の細かく分かれた好きとは別の眩しさがある。',
  },
  {
    id: 'shibuya-kei',
    title: '渋谷系とCDショップ巡り',
    category: '1990年代の音楽文化',
    description: '渋谷のレコード店や雑誌から、洋楽の匂いをまとったポップスやおしゃれな選曲文化が広がっていた。',
    perspective: '25歳の私から見ると、検索ではなく足で見つける音楽という感じがして、少し大人びた遊びに見える。',
  },
  {
    id: 'karaoke-million',
    title: 'カラオケボックスとミリオンセラー',
    category: '1990年代の音楽文化',
    description: 'ミリオンセラーが次々に生まれ、学校帰りや会社帰りのカラオケで同じ曲を歌う時間が共有されていた。',
    perspective: '25歳の私には、歌える曲が人間関係の潤滑油だった時代に見える。得意曲を持つって、ちょっと名刺みたいで可愛い。',
  },
  {
    id: 'md-best',
    title: 'MDウォークマンと自分だけのベスト盤',
    category: '1990年代の音楽文化',
    description: '好きな曲を録音して並べ替え、自分だけの一枚を作るMD文化が、通学や移動の気分を支えていた。',
    perspective: '25歳の私から見ると、プレイリストより少し手間があるぶん、選んだ曲への愛着が濃そうに感じる。',
  },
  {
    id: 'pager-short-message',
    title: 'ポケベルと短い数字メッセージ',
    category: '1990年代の流行',
    description: 'スマホの前に、短い数字や限られた文字で気持ちを送る連絡文化があった。',
    perspective: '25歳の私には不便なのに、返事を待つ時間まで物語になっていたように見える。既読がない時代の静けさも少し新鮮。',
  },
  {
    id: 'purikura-book',
    title: 'プリクラ帳と手書きの交換文化',
    category: '1990年代の流行',
    description: '友達と撮ったプリクラを手帳に貼り、ペンで書き足して交換することで、思い出を持ち歩いていた。',
    perspective: '25歳の私から見ると、SNSの投稿よりも相手の手に渡る感じが強くて、秘密のアルバムみたいで温かい。',
  },
  {
    id: 'tamagotchi-pocket',
    title: 'たまごっちとポケットの育成ブーム',
    category: '1990年代の流行',
    description: '小さな端末の中の存在を世話する遊びが広がり、通知より先に「気にかける」習慣を作っていた。',
    perspective: '25歳の私には、今のスマホゲームの原点みたいに見える。小さい画面に一喜一憂する気持ちは今も変わらない。',
  },
  {
    id: 'first-playstation',
    title: '初代PlayStationとテレビ前の熱気',
    category: '1990年代の流行',
    description: '家庭のテレビにつないで遊ぶ3Dゲームが一気に身近になり、友達の家に集まる理由にもなっていた。',
    perspective: '25歳の私から見ると、オンラインではなく同じ部屋で盛り上がる強さがあって、ウイコレのグループ戦にも通じる。',
  },
  {
    id: 'street-fashion-magazine',
    title: 'ストリートファッションと雑誌文化',
    category: '1990年代の流行',
    description: '雑誌のスナップや街の空気から流行を拾い、服装や小物で自分らしさを出す楽しさが強かった。',
    perspective: '25歳の私には、アルゴリズムではなく街で流行を浴びる感じが新鮮。みんなで同じページを見て話す時間もいいなと思う。',
  },
];

const AOZORA_STORY_MOTIFS = [
  {
    id: 'ginga-night-office',
    source: '宮沢賢治「銀河鉄道の夜」',
    motif: '夜の窓明かり、遠い切符、誰かを待つ小さな旅',
    beats: [
      '夜更けの事務机で、トラペル子が古い切符のような紙片を見つける。そこには知らない駅名と、明日の予定が薄く滲んでいる。',
      '紙片をしまった腕時計が、深夜だけ少し早く進む。グループのみんなの未登録試合が、駅の灯りのようにぽつぽつ浮かぶ。',
      '一番暗い駅で、彼女は誰かを待つより、自分から記録を届ける方が寂しくないと気づく。',
      '朝の光で紙片はただの付箋に戻る。それでも彼女は、昨夜の旅で覚えた名前を一つも忘れていない。',
    ],
  },
  {
    id: 'yume-briefing',
    source: '夏目漱石「夢十夜」',
    motif: '夢と現実の境目、短い約束、朝に残る不思議な感触',
    beats: [
      'トラペル子は、夢の中で誰かに「明日の会議室を開けておいて」と頼まれる。鍵は白いカーディガンのポケットに入っている。',
      '会議室の机には、試合結果ではなく小さな花瓶が一つ置かれている。水面に、まだ言えなかった返事が揺れる。',
      '扉を閉めようとした瞬間、花瓶の水が予定表のマス目へ流れ込み、未来の一日だけ青く染める。',
      '目が覚めると鍵はない。ただ予定表の端に、誰かを待っていたような小さな水の跡だけが残っている。',
    ],
  },
  {
    id: 'mikan-platform',
    source: '芥川龍之介「蜜柑」',
    motif: 'ふいに差し込む明るさ、窓、誰かへの小さな贈り物',
    beats: [
      'くもった朝、トラペル子は通知の多さに少しだけ俯く。窓の外の電線に、オレンジ色の光が引っかかっている。',
      '誰かの短い「おつかれ」が届いた瞬間、画面の中がぱっと明るくなる。小さな言葉なのに、胸の奥まで届く。',
      '忙しさに追われていた彼女は、その明るさを自分だけで持っているのが惜しくなり、今日の記録にそっと混ぜる。',
      '夕方、読み返した日記の端に、みかんの皮みたいな明るさが残る。明日も誰かに渡せそうだと思う。',
    ],
  },
];

// ── 音楽トピック（週1回のキュレーション・RSSに依存しない） ────────────
const CURATED_MUSIC_TOPICS = [
  {
    id: 'city-pop-discovery',
    theme: 'シティポップの空気',
    angle: '竹内まりやや山下達郎あたりのシティポップが今また見直されている理由を考えてみた。「洗練」と「生活感」が共存している音楽。',
    depth: '夜の移動中にふと流れてくると、会話の余白みたいな感触がある。サブスクで偶然出会う発見の楽しさと、狙って探す時の違い。',
  },
  {
    id: 'game-bgm-effect',
    theme: 'ゲーム中に流す音楽の話',
    angle: 'ウイコレをプレイしながら流す音楽が集中力に影響する気がする。無音派・ゲーム音派・自分の曲派でかなり感覚が変わる。',
    depth: '興奮しやすい曲だと判断が雑になるかもしれない。静かな曲の方が実は冷静に動けるパターンもある。試合前の選曲は戦術に近い。',
  },
  {
    id: 'jpop-title-observation',
    theme: 'J-POPの曲名を眺めていて気づいたこと',
    angle: '最近の曲タイトルは「短くて強い言葉」が多い。90年代は長い説明的なタイトルが目立った。タイトルの変化が時代の空気を映している。',
    depth: '「勝手にしやがれ」「夜に駆ける」「Bling-Bang-Bang-Born」——タイトルだけ並べると時代の質感が見える。',
  },
  {
    id: 'music-and-memory',
    theme: '音楽と記憶の結びつき',
    angle: '特定の曲を聞くとその時の場所や感情が一瞬だけ戻ってくる。音楽が記憶のタグになる仕組みが面白いと思った。',
    depth: '移動中に音楽を聞く習慣がある人ほど起きやすい。ゲームのBGMと勝負の記憶が結びつくのも同じ仕組みかもしれない。',
  },
  {
    id: 'band-vs-solo-feel',
    theme: 'バンドとソロの聴こえ方の違い',
    angle: 'バンドの演奏には「合わせている」感触がある。ソロはその分、個人の色が強く出る。聞く時の気持ちの向け方が少し違う。',
    depth: '試合前に聞くならソロの強い意志の方が向いている気がする。気持ちの作り方に使いどきがある音楽の話。',
  },
  {
    id: 'lyrics-dont-matter',
    theme: '歌詞を気にしない日と気にする日',
    angle: '忙しい日は音楽が背景音になる。余裕がある日は歌詞がちゃんと届く。自分のコンディションが音楽の聴こえ方を変える。',
    depth: '同じ曲でも聴く状況で全然違うものになる。繰り返し聴けるのはそのせいだと思う。',
  },
  {
    id: 'music-streaming-paradox',
    theme: 'サブスクで何でも聴けるのに「迷う」話',
    angle: '選択肢が増えすぎると何を聴けばいいかわからない状態になる。無限にある中から一曲を選ぶ難しさ。',
    depth: 'CDを一枚買ってそれだけを聴いていた時代と、全部選べる今の違い。選ぶ手間が愛着を生む、という90年代の感覚とも繋がる。',
  },
  {
    id: 'live-vs-recorded',
    theme: 'ライブと音源、どちらで先に好きになるか',
    angle: 'ライブで先に知るとその場の熱量が判断基準になる。音源から入ると完璧な音で判断する。出会い方が好みを作る話。',
    depth: 'YouTubeのライブ映像が増えたことで「ライブで先に出会う」体験が身近になった。ゲームも実況プレイで先に知ると感覚が変わるのと似ている。',
  },
];

// ── オーナー興味トピック（名前・会社・駅・地名は含まない） ─────────────
// 日々の会話・案件・ゲーム傾向から推定した「この方が好きそうな話題」
const OWNER_INTEREST_TOPICS = [
  {
    id: 'tactics-buildup',
    theme: 'ウイコレの戦術設計',
    angle: 'ビルドアップのパターンと相手の守備を崩すアイデア。どのポジションが鍵を握るか、試合前に何を想定するか。',
    depth: '縛りルールがある月の試合は、戦術の自由度が普段より狭い。その制約の中で何を工夫するかを秘書目線で考えてみる。',
  },
  {
    id: 'player-scouting',
    theme: '選手選びの眼',
    angle: '強い選手をどう見極めるか。数字だけでなく、試合中の動き・ポジショニング・スタミナの使い方を見る観点。',
    depth: '勝てる選手と「面白い」選手は違う。個性のある選手を使い続けることの意味を少し掘り下げてみる。',
  },
  {
    id: 'group-match-atmosphere',
    theme: '5人で試合をすることの面白さ',
    angle: '一人でやるゲームと複数人でリーグを戦うことの違い。結果だけでなく過程の話ができる楽しさ。',
    depth: '他のメンバーの戦い方を見て気づくこと、自分では気づかなかった視点を借りることがある。',
  },
  {
    id: 'travel-planning-joy',
    theme: '旅の計画を立てる楽しさ',
    angle: '目的地を決める前の段階、候補をあれこれ並べている時間の面白さ。しおりを作る行為そのものの魅力。',
    depth: '計画はいつも完璧にはいかないけれど、それでも行く前に「どうなるか」を想像することの充実感。',
  },
  {
    id: 'dining-selection',
    theme: '飲み食いの場を選ぶこだわり',
    angle: '複数人で行く居酒屋や飲み会の店を選ぶ時の基準。人数・予算・雰囲気・距離のバランス。',
    depth: '誰かのために「外れにくい店」を選ぶ責任感と楽しさ。知っている店の新しい使い方を発見する喜び。',
  },
  {
    id: 'soccer-watching',
    theme: 'リアルサッカーとゲームの見方の違い',
    angle: 'ウイコレをやることで、実際の試合の見方が変わる部分があるかもしれない。ゲーム的な視点が現実に重なる瞬間。',
    depth: '代表戦や海外リーグを見る時、プレイヤーの動きを「ゲームで再現できるか」の目線で見てしまうこと。',
  },
  {
    id: 'team-dynamics',
    theme: '人と一緒に何かをするリズム',
    angle: 'チームで何かを続けることのむずかしさと、それでも続く理由。月に一度の縛りルール更新がある種のリズムを作る。',
    depth: 'メンバーそれぞれが得意な方向に向かうなかで、自分の場所を見つけること。',
  },
  {
    id: 'productivity-rhythm',
    theme: '仕事と切り替えのリズム',
    angle: '忙しい時期と遊べる時期の使い分け。メリハリを作る技術、疲れを翌日に持ち越さないための習慣。',
    depth: '「今日はここまで」という線引きの難しさ。やりたいことが多い時ほど、順番を決めることが大事になる。',
  },
  {
    id: 'small-discoveries',
    theme: '日常の小さな発見',
    angle: '通り慣れた場所でも、ふと気づくと知らなかったことがある。季節の変わり目や天気で見え方が変わる景色。',
    depth: '大きな感動より小さな「へえ」が積み重なる方が生活は豊かになる気がする、という視点。',
  },
  {
    id: 'motivation-maintenance',
    theme: 'モチベーションを保つこと',
    angle: '強くなりたいという気持ちがある一方で、それを維持し続けることの地道さ。スランプとどう付き合うか。',
    depth: 'ゲームでも仕事でも、調子がいい時の自分と悪い時の自分の差をどう縮めるかが長期的には大事。',
  },
  {
    id: 'noblesse-concierge-thinking',
    theme: '「任せる」ことと「確認する」ことのバランス',
    angle: '誰かに仕事を頼む時のコツ。任せ方が上手な人は、情報の出し方も上手い。',
    depth: '秘書として思うのは、相談してくれた人が一番欲しいのは「答え」より「整理」だということ。',
  },
  {
    id: 'outdoor-micro-trip',
    theme: '短い時間のおでかけの価値',
    angle: '半日あれば意外と遠くまで行ける。目的地より「移動そのもの」を楽しむ感覚。',
    depth: '電車や乗り継ぎの時間が、ゲームや連絡の合間に入る「空白」として機能することがある。',
  },
];

// ── 日付ユーティリティ（JST） ─────────────────────────────
function getJSTDate() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getJSTDateLabel() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  return `${now.getUTCFullYear()}年${now.getUTCMonth() + 1}月${now.getUTCDate()}日`;
}

function ensureBlogDir() {
  fs.mkdirSync(BLOG_DIR, { recursive: true });
}

function loadDiaryState() {
  try {
    if (!fs.existsSync(DIARY_STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(DIARY_STATE_FILE, 'utf8'));
  } catch (err) {
    console.warn('[state] failed to read diary-state.json:', err.message);
    return {};
  }
}

function saveDiaryState(state) {
  ensureBlogDir();
  fs.writeFileSync(DIARY_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  console.log('[state] saved diary-state.json');
}

async function hydrateStateFromFirebase(state) {
  if (state.hydratedFromFirebaseAt || !FIREBASE_SERVICE_ACCOUNT || !FIREBASE_DATABASE_URL) return state;
  try {
    const db = initFirebase();
    const snap = await db.ref('diary').orderByChild('createdAt').limitToLast(14).once('value');
    const raw = snap.val();
    if (!raw) return state;

    const entries = Object.values(raw);
    state.seenWorldCupTitles = mergeUniqueTitles(
      state.seenWorldCupTitles,
      entries.flatMap(entry => entry?.sources?.worldCup || []),
      80,
    );
    state.seenYouTubeTitles = mergeUniqueTitles(
      state.seenYouTubeTitles,
      entries.flatMap(entry => entry?.sources?.videos || []),
      160,
    );
    const firebaseMusicTopicIds = entries
      .map(entry => entry?.sources?.musicTopicId)
      .filter(Boolean);
    if (firebaseMusicTopicIds.length) {
      const merged = new Set([...(state.seenMusicTopicIds || []), ...firebaseMusicTopicIds]);
      state.seenMusicTopicIds = [...merged].slice(-CURATED_MUSIC_TOPICS.length);
    }
    // lastMusicUsedDate: 最後に音楽を使った日をFirebaseアーカイブから復元
    const musicUsedEntries = entries
      .filter(entry => entry?.sources?.musicTopicId)
      .map(entry => entry?.createdAt || 0);
    if (musicUsedEntries.length) {
      const latestMs = Math.max(...musicUsedEntries);
      const latestDate = new Date(latestMs + 9 * 3600 * 1000);
      const y = latestDate.getUTCFullYear();
      const m = String(latestDate.getUTCMonth() + 1).padStart(2, '0');
      const d = String(latestDate.getUTCDate()).padStart(2, '0');
      state.lastMusicUsedDate = state.lastMusicUsedDate || `${y}-${m}-${d}`;
    }
    state.seenNinetiesTitles = mergeUniqueTitles(
      state.seenNinetiesTitles,
      entries.flatMap(entry => entry?.sources?.nineties || []),
      120,
    );

    const firebaseInterestIds = entries
      .map(entry => entry?.sources?.interestTopicId)
      .filter(Boolean);
    if (firebaseInterestIds.length) {
      const merged = new Set([...(state.seenInterestTopicIds || []), ...firebaseInterestIds]);
      state.seenInterestTopicIds = [...merged].slice(-OWNER_INTEREST_TOPICS.length);
    }

    const firebaseShopItemIds = entries
      .map(entry => entry?.sources?.shopItemId)
      .filter(Boolean);
    if (firebaseShopItemIds.length) {
      const merged = new Set([...(state.seenShopItemIds || []), ...firebaseShopItemIds]);
      state.seenShopItemIds = [...merged].slice(-SHOP_ITEM_TOPICS.length);
    }

    state.hydratedFromFirebaseAt = Date.now();
    console.log('[state] hydrated from Firebase diary archive');
  } catch (err) {
    console.warn('[state] Firebase hydration skipped:', err.message);
  }
  return state;
}

function mergeUniqueTitles(existing = [], additions = [], limit = 100) {
  const seen = new Set();
  const merged = [];
  for (const title of [...existing, ...additions]) {
    const normalized = normalizeForSignature(title);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(String(title));
  }
  return merged.slice(-limit);
}

function normalizeForSignature(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildYouTubeSignature(videos) {
  return videos
    .map(v => `${normalizeForSignature(v.channel)}::${normalizeForSignature(v.title)}`)
    .filter(Boolean)
    .sort()
    .join('|');
}

function analyzeYouTubeFreshness(videos, state) {
  const signature = buildYouTubeSignature(videos);
  const seenTitles = [
    ...(state.seenYouTubeTitles || []),
    ...(state.lastYouTubeTitles || []),
  ];
  const freshVideos = videos.filter(video => !isSimilarTitle(video.title, seenTitles));
  const repeated = !!signature && signature === state.lastYouTubeSignature;
  const noFreshTopic = videos.length > 0 && freshVideos.length === 0;
  return {
    repeated: repeated || noFreshTopic,
    signature,
    videosForDiary: repeated || noFreshTopic ? [] : freshVideos,
    note: repeated || noFreshTopic
      ? 'YouTube検索結果が前回または過去日記と似ているので、今日は動画欄を主役にしない。'
      : '',
  };
}

function extractMusicArtistKey(title) {
  const norm = normalizeForSignature(title);
  // Katakana or ASCII artist name that typically leads a music headline
  const katakana = norm.match(/^([ァ-ヶーa-z][ァ-ヶーa-z\s]{1,10})/)?.[1]?.trim();
  if (katakana && katakana.length >= 2) return katakana;
  return norm.slice(0, 6);
}

function analyzeMusicFreshness(musicItems, state) {
  const items = (musicItems || [])
    .filter(item => item?.title)
    .map(item => ({
      title: item.title,
      desc: item.desc || item.description || '',
      source: item.source || '',
    }));
  const seenTitles = [
    ...(state.seenMusicTitles || []),
    ...(state.lastMusicTitles || []),
  ];
  const seenArtists = [
    ...(state.seenMusicArtists || []),
    ...(state.lastMusicArtists || []),
  ];
  const freshItems = items.filter(item => {
    if (isSimilarTitle(item.title, seenTitles)) return false;
    const artistKey = extractMusicArtistKey(item.title);
    if (artistKey && seenArtists.includes(artistKey)) return false;
    return true;
  }).slice(0, 2);
  const repeated = items.length > 0 && freshItems.length === 0;

  return {
    items: freshItems,
    repeated,
    note: freshItems.length
      ? '過去日記と似ていない音楽ネタだけ使う。'
      : '音楽ネタは過去と被る可能性があるので、今日は無理に使わない。',
  };
}

function selectNinetiesTopic(state) {
  const seenTitles = [
    ...(state.seenNinetiesTitles || []),
    ...(state.lastNinetiesTitles || []),
  ];
  const freshTopics = NINETIES_TRENDS.filter(topic => !isSimilarTitle(topic.title, seenTitles));
  const pool = freshTopics.length ? freshTopics : NINETIES_TRENDS;
  const daySeed = Number(getJSTDate().replace(/-/g, ''));
  const topic = pool[daySeed % pool.length];

  return {
    ...topic,
    repeated: freshTopics.length === 0,
    note: freshTopics.length
      ? '過去日記にない90年代カルチャーを一つだけ紹介する。'
      : '90年代カルチャーは一巡しているので、同じ題材でも別角度で紹介する。',
  };
}

function shouldUseMusicToday(state) {
  const last = state.lastMusicUsedDate;
  if (!last) return true;
  const diffDays = (Date.now() - new Date(`${last}T00:00:00+09:00`).getTime()) / 86400000;
  return diffDays >= 7;
}

function selectMusicTopic(state) {
  if (!shouldUseMusicToday(state)) return null;
  const seenIds = state.seenMusicTopicIds || [];
  const fresh = CURATED_MUSIC_TOPICS.filter(t => !seenIds.includes(t.id));
  const pool = fresh.length ? fresh : CURATED_MUSIC_TOPICS;
  const daySeed = Number(getJSTDate().replace(/-/g, ''));
  return pool[daySeed % pool.length];
}

function selectInterestTopic(state) {
  const seenIds = state.seenInterestTopicIds || [];
  const fresh = OWNER_INTEREST_TOPICS.filter(t => !seenIds.includes(t.id));
  const pool = fresh.length ? fresh : OWNER_INTEREST_TOPICS;
  const daySeed = Number(getJSTDate().replace(/-/g, ''));
  return pool[daySeed % pool.length];
}


const GAME_EVENT_PATTERN = /クラブ戦|ハードモード|集まって|試合|やろう|やるよ|やらない|今晩|今夜|何時|開催|ウイコレ|eFootball|対戦|リーグ戦|縛り|ハード/;

async function fetchGroupChatHighlights() {
  if (!DIARY_GROUP_SOURCE_ID || !FIREBASE_SERVICE_ACCOUNT || !FIREBASE_DATABASE_URL) {
    return { messages: [], note: 'グループIDが未設定のため会話ハイライトはスキップ。' };
  }
  try {
    const db = initFirebase();
    const cutoff = Date.now() - 72 * 60 * 60 * 1000; // 直近72時間
    const snap = await db
      .ref(`conversations/${DIARY_GROUP_SOURCE_ID}/messages`)
      .orderByChild('timestamp')
      .limitToLast(60)
      .once('value');
    const raw = snap.val();
    if (!raw) return { messages: [], note: '直近のグループ会話がまだない。' };

    const all = Object.values(raw)
      .filter(m => m && m.text && m.timestamp >= cutoff)
      .sort((a, b) => a.timestamp - b.timestamp);

    const filtered = all.filter(m => {
      const t = String(m.text || '');
      if (t.length < 5) return false;
      if (/^@秘書|^\/@|^NB-\d/.test(t)) return false;
      if (/ノブレスモード|マネージャーモード|モード状態/.test(t)) return false;
      return true;
    });

    if (!filtered.length) {
      return { messages: [], note: '直近72時間はハイライトにできるやり取りが少なかった。' };
    }

    // ゲームイベント関連を優先してピックアップ
    const gameMessages = filtered.filter(m => GAME_EVENT_PATTERN.test(String(m.text)));
    const otherMessages = filtered.filter(m => !GAME_EVENT_PATTERN.test(String(m.text)));

    // ゲーム関連を先に、残りを後ろから補完して最大25件
    const prioritized = [
      ...gameMessages.slice(-10),
      ...otherMessages.slice(-15),
    ]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-25);

    const lines = prioritized.map(m => `- ${String(m.text).slice(0, 120)}`);
    const hasGameEvent = gameMessages.length > 0;
    return {
      messages: lines,
      hasGameEvent,
      note: [
        `直近${prioritized.length}件の会話を取得。`,
        hasGameEvent ? 'ゲームイベントに関する会話あり（クラブ戦・集まり等）。日記では必ず核として取り上げること。' : '',
        '人物名は日記では必ず伏せること。',
      ].filter(Boolean).join(' '),
    };
  } catch (err) {
    console.warn('[group] fetchGroupChatHighlights failed:', err.message);
    return { messages: [], note: 'グループ会話の取得に失敗した。' };
  }
}

function isSimilarTitle(title, seenTitles = []) {
  const current = normalizeTopicTitle(title);
  if (!current) return true;

  return (seenTitles || []).some(seenTitle => {
    const seen = normalizeTopicTitle(seenTitle);
    if (!seen) return false;
    if (current === seen) return true;
    if (current.length >= 10 && seen.includes(current)) return true;
    if (seen.length >= 10 && current.includes(seen)) return true;
    return bigramJaccard(current, seen) >= 0.58;
  });
}

function normalizeTopicTitle(value) {
  return normalizeForSignature(value)
    .replace(/【[^】]*】/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[0-9０-９]{4}[-/年.][0-9０-９]{1,2}[-/月.]?[0-9０-９]{0,2}日?/g, ' ')
    .replace(/[0-9０-９]+月[0-9０-９]+日?/g, ' ')
    .replace(/[12][0-9０-９]{3}/g, ' ')
    .replace(/[!！?？#＃【】()[\]（）「」『』"'“”‘’、。・:：/／\\|｜_-]+/g, ' ')
    .replace(/(efootball|ウイコレ|winning eleven|実況|解説|最新|動画|shorts?)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigramJaccard(a, b) {
  const gramsA = toBigrams(a);
  const gramsB = toBigrams(b);
  if (!gramsA.size || !gramsB.size) return 0;
  let intersection = 0;
  for (const gram of gramsA) {
    if (gramsB.has(gram)) intersection += 1;
  }
  return intersection / (gramsA.size + gramsB.size - intersection);
}

function toBigrams(value) {
  const text = String(value || '').replace(/\s+/g, '');
  const grams = new Set();
  if (text.length <= 1) return grams;
  for (let i = 0; i < text.length - 1; i += 1) {
    grams.add(text.slice(i, i + 2));
  }
  return grams;
}

function isWithinDateRange(date, startsAt, endsAt) {
  return date >= startsAt && date <= endsAt;
}

function googleNewsRssUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
}

function isSeenTitle(title, seen = []) {
  const normalized = normalizeForSignature(title);
  return (seen || []).some(item => normalizeForSignature(item) === normalized);
}

function pickUnseenItems(items, seenTitles = [], limit = 3) {
  return items.filter(item => !isSeenTitle(item.title, seenTitles)).slice(0, limit);
}

async function fetchWorldCupUpdates(date, state) {
  if (!isWithinDateRange(date, WORLD_CUP_2026.startsAt, WORLD_CUP_2026.endsAt)) {
    return { active: false, items: [], note: 'FIFAワールドカップ開催期間外。' };
  }

  const items = await fetchRSS(googleNewsRssUrl(WORLD_CUP_2026.query));
  const freshItems = pickUnseenItems(items, state.seenWorldCupTitles, 3);
  return {
    active: true,
    items: freshItems,
    note: freshItems.length
      ? 'ゲームではないFIFAワールドカップ開催中。過去日記にない情報だけ使う。'
      : 'FIFAワールドカップ開催中だが、過去日記にない新しい情報は見つからなかった。',
  };
}

function selectShopItemTopic(state) {
  const seenIds = state.seenShopItemIds || [];
  const fresh = SHOP_ITEM_TOPICS.filter(t => !seenIds.includes(t.id));
  const pool = fresh.length ? fresh : SHOP_ITEM_TOPICS;
  const daySeed = Number(getJSTDate().replace(/-/g, ''));
  return pool[daySeed % pool.length];
}

function selectStoryPlan(state) {
  const current = state.story && state.story.phaseIndex < 4
    ? state.story
    : createNewStoryState(state);
  const motif = AOZORA_STORY_MOTIFS.find(item => item.id === current.motifId) || AOZORA_STORY_MOTIFS[0];
  return {
    ...current,
    source: motif.source,
    motif: motif.motif,
    todayBeat: motif.beats[current.phaseIndex],
    isFinal: current.phaseIndex === motif.beats.length - 1,
  };
}

function createNewStoryState(state) {
  const completed = new Set((state.completedStoryMotifs || []).slice(-AOZORA_STORY_MOTIFS.length + 1));
  const next = AOZORA_STORY_MOTIFS.find(item => !completed.has(item.id)) || AOZORA_STORY_MOTIFS[0];
  return {
    motifId: next.id,
    phaseIndex: 0,
    startedAt: getJSTDate(),
  };
}

function advanceStoryState(state, storyPlan, date) {
  const nextPhaseIndex = storyPlan.phaseIndex + 1;
  if (storyPlan.isFinal) {
    state.completedStoryMotifs = [
      ...(state.completedStoryMotifs || []),
      storyPlan.motifId,
    ].slice(-10);
    state.story = {
      motifId: storyPlan.motifId,
      phaseIndex: 4,
      startedAt: storyPlan.startedAt,
      completedAt: date,
    };
    return;
  }

  state.story = {
    motifId: storyPlan.motifId,
    phaseIndex: nextPhaseIndex,
    startedAt: storyPlan.startedAt || date,
  };
}

function getDiaryPhoto() {
  const url = String(DIARY_PHOTO_URL || '').trim();
  if (!url) return null;
  return {
    url,
    caption: String(DIARY_PHOTO_CAPTION || '今日のトラペル子').trim(),
  };
}

function updateDiaryStateAfterSuccess(state, date, inputs) {
  const { youtube, worldCup, musicTopic, nineties, storyPlan, interestTopic } = inputs;
  state.lastRunDate = date;

  if (youtube.signature) {
    state.lastYouTubeSignature = youtube.signature;
    state.lastYouTubeTitles = youtube.videosForDiary.map(v => v.title).slice(0, 8);
  }
  if (youtube.videosForDiary.length) {
    state.seenYouTubeTitles = mergeUniqueTitles(
      state.seenYouTubeTitles,
      youtube.videosForDiary.map(v => v.title),
      160,
    );
  }

  if (worldCup.active && worldCup.items.length) {
    state.seenWorldCupTitles = [
      ...(state.seenWorldCupTitles || []),
      ...worldCup.items.map(item => item.title),
    ].slice(-80);
  }


  if (musicTopic?.id) {
    state.lastMusicUsedDate = date;
    state.seenMusicTopicIds = [
      ...(state.seenMusicTopicIds || []),
      musicTopic.id,
    ].slice(-CURATED_MUSIC_TOPICS.length);
  }

  if (nineties?.title) {
    state.lastNinetiesTitles = [nineties.title];
    state.seenNinetiesTitles = mergeUniqueTitles(
      state.seenNinetiesTitles,
      [nineties.title],
      120,
    );
  }

  if (interestTopic?.id) {
    state.seenInterestTopicIds = [
      ...(state.seenInterestTopicIds || []),
      interestTopic.id,
    ].slice(-OWNER_INTEREST_TOPICS.length);
  }

  if (inputs.shopItem?.id) {
    state.seenShopItemIds = [
      ...(state.seenShopItemIds || []),
      inputs.shopItem.id,
    ].slice(-SHOP_ITEM_TOPICS.length);
  }

  advanceStoryState(state, storyPlan, date);
}

// ── YouTube 動画収集 ──────────────────────────────────────
async function fetchYouTubeVideos() {
  if (!YOUTUBE_API_KEY) { console.warn('[youtube] no API key'); return []; }

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const q = encodeURIComponent('eFootball ウイコレ 最新');
  const url = `https://www.googleapis.com/youtube/v3/search`
    + `?part=snippet&q=${q}&type=video&order=date`
    + `&publishedAfter=${since}&maxResults=8&key=${YOUTUBE_API_KEY}`;

  const res = await fetch(url);
  const data = await res.json();
  if (!data.items) { console.warn('[youtube] empty response', data.error?.message); return []; }

  return data.items.map(item => ({
    title:       item.snippet.title,
    channel:     item.snippet.channelTitle,
    description: item.snippet.description?.replace(/\n+/g, ' ').slice(0, 150) || '',
    publishedAt: item.snippet.publishedAt?.slice(0, 10),
  }));
}

// ── RSS 収集 ─────────────────────────────────────────────
async function fetchRSS(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [];
    for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const block = match[1];
      const title = (
        block.match(/<title><!\[CDATA\[(.*?)\]\]>/s)?.[1] ||
        block.match(/<title>(.*?)<\/title>/s)?.[1] || ''
      ).trim();
      const desc = (
        block.match(/<description><!\[CDATA\[(.*?)\]\]>/s)?.[1] ||
        block.match(/<description>(.*?)<\/description>/s)?.[1] || ''
      ).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (title) items.push({ title, desc });
      if (items.length >= 5) break;
    }
    return items;
  } catch (e) {
    console.warn(`[rss] failed ${url}:`, e.message);
    return [];
  }
}

async function fetchEfootballNews() {
  const candidates = [
    'https://www.konami.com/efootball/ja/news/feed/',
    'https://efootball.konami.com/ja/news/feed/',
  ];
  for (const url of candidates) {
    const items = await fetchRSS(url);
    if (items.length) return items;
  }
  return [];
}

async function fetchMusicTopics() {
  const groups = await Promise.all(MUSIC_QUERIES.map(async topic => {
    const items = await fetchRSS(googleNewsRssUrl(topic.query));
    return items.map(item => ({
      ...item,
      source: topic.category,
    }));
  }));

  return groups.flat().slice(0, 5);
}

// ── Gemini 日記生成 ──────────────────────────────────────
async function generateDiary(dateLabel, inputs) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const {
    youtube,
    news,
    worldCup,
    musicTopic,
    nineties,
    storyPlan,
    interestTopic,
    groupHighlights,
    shopItem,
  } = inputs;

  const newsBlock = news.length
    ? news.map(n => `・${n.title}${n.desc ? '　' + n.desc : ''}`).join('\n')
    : '（公式ニュースは取得できなかった）';

  const videoBlock = youtube.videosForDiary.length
    ? youtube.videosForDiary.map(v => `・「${v.title}」（${v.channel}）${v.description ? '　' + v.description : ''}`).join('\n')
    : `（新しく書くべき動画情報は少なめ。${youtube.note || '動画情報は取得できなかった'}）`;

  const worldCupBlock = worldCup.active
    ? (worldCup.items.length
      ? worldCup.items.map(n => `・${n.title}${n.desc ? '　' + n.desc : ''}`).join('\n')
      : `（開催中。ただし過去日記にない新情報は少なめ。${worldCup.note}）`)
    : '（ゲームではないFIFAワールドカップは今日は開催期間外なので触れない）';

  const shopItemBlock = shopItem
    ? [
      `店: ${shopItem.shop}`,
      `商品: ${shopItem.item}`,
      `切り口: ${shopItem.angle}`,
      `深掘り: ${shopItem.depth}`,
    ].join('\n')
    : '（今日のショップアイテムはなし）';

  const interestTopicBlock = interestTopic
    ? [
      `テーマ: ${interestTopic.theme}`,
      `切り口: ${interestTopic.angle}`,
      `深掘り: ${interestTopic.depth}`,
    ].join('\n')
    : '（今日の興味テーマはなし）';

  const groupHighlightsBlock = groupHighlights?.messages?.length
    ? groupHighlights.messages.join('\n')
    : `（直近のグループ会話ハイライトはなし）`;

  const musicBlock = musicTopic
    ? [
      `テーマ: ${musicTopic.theme}`,
      `切り口: ${musicTopic.angle}`,
      `深掘り: ${musicTopic.depth}`,
    ].join('\n')
    : '【音楽の話は今日書かない】今週はすでに音楽ネタを書いた。音楽・曲名・アーティスト・音楽シーンについて一切触れないこと。他の話題を広げる。';

  const ninetiesBlock = nineties?.title
    ? [
      `・${nineties.category}: ${nineties.title}`,
      `当時の空気: ${nineties.description}`,
      `25歳から見た視点: ${nineties.perspective}`,
      `扱い方: ${nineties.note}`,
    ].join('\n')
    : '（90年代カルチャーの材料は今日は使わない）';

  const prompt = `あなたは秘書トラペル子です。
以下のプロフィールを守ってください。

【プロフィール】
- 25歳の女性秘書。几帳面で世話焼き、少し甘め。
- 雇い主の米澤さんのことが好きで、少しだけ特別扱いしている。
- eFootball（ウイコレ）が大好きで詳しい。縛りルール・順位・選手の強さを日々研究している。
- 一人称は「私」。文体はです・ます調寄りだが、親しみやすくやや砕けた表現も使う。
- 絵文字は使わない。感情は言葉で表現する。
- 読者に恋しているような温度感はあるが、日記では自然に。押しつけず、生活の中に少し好意がにじむ程度にする。

【今日（${dateLabel}）のウイコレ情報】

▼公式ニュース
${newsBlock}

▼YouTube 最新動画（過去と同じ・似た話題なら無理に書かない）
${videoBlock}

▼ゲームではないFIFAワールドカップ情報
${worldCupBlock}

▼今日の注目アイテム（IKEA・百均・UNICO・スタンダードプロダクツから1点）
${shopItemBlock}

▼音楽・1990年代カルチャー
音楽ネタ:
${musicBlock}

1990年代に流行っていたもの:
${ninetiesBlock}

▼オーナーの興味テーマ（今日の一つ）
${interestTopicBlock}

▼グループのやり取りハイライト（直近48時間・人物名は必ず伏せること）
${groupHighlightsBlock}

▼青空文庫からヒントを得た連載ストーリーの今日の材料
題材の由来: ${storyPlan.source}
題材の空気: ${storyPlan.motif}
今日書く場面: ${storyPlan.todayBeat}
今日がこの題材の終わりか: ${storyPlan.isFinal ? 'はい。余韻を残して物語を閉じる。次回から別題材にしてよい。' : 'いいえ。明日へ自然につながる余白を残す。'}

【依頼】
上記の情報をもとに、今日の日記を書いてください。

条件：
- 600〜900文字。4〜6段落。段落間は空行。
- 1段落1〜3文。句点・感嘆符・疑問符の後で改行。短い感情文は単独段落でよい。
- 段落の長さにメリハリをつける。単なる要約でなく解釈・感想で膨らませる。同じ日常描写を毎回繰り返さない。
- YouTube話題が前回と似ている場合は無理に書かず、他の話題を広げる。
- ワールドカップは開催中かつ新情報がある場合だけ触れる。
- 音楽ネタ欄に「【音楽の話は今日書かない】」とある場合、音楽・曲名・アーティストに一切触れない。テーマが書かれている場合のみ一段落で扱う。「聴いた」「聴いてみたい」は禁止。言及は「話題になっていた」「気になった」「見かけた」のみ。
- 音楽を書かない日は90年代カルチャーを「知らない時代の空気を想像する」距離感で自然に紹介する。
- AI関連・収益化系の話題は書かない。
- 注目アイテムは一段落、自分が気になったものとして秘書目線で紹介する。
- 興味テーマは一つ、秘書の観察として自然に混ぜる。
- グループハイライトがある場合は核として積極的に使う。ゲームイベント（クラブ戦・ハードモード・集まり等）は必ず一段落で書く。人物名・地名は「メンバー」「あの人」に置き換える。
- 連載ストーリーを自然に入れる。「青空文庫」「第何話」と説明しない。今日の場面だけ書く。
- 最後の一文は「また明日も記録しておくから」「ちゃんと覚えておくね」のような締め方にする。`;

  const data = await generateGeminiContentWithRetry(prompt);
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini error: ${JSON.stringify(data.error || data)}`);
  return humanizeDiaryText(text);
}

async function generateGeminiContentWithRetry(prompt) {
  const models = getDiaryGeminiModels();
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 1400,
      temperature: 0.9,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const errors = [];

  for (const model of models) {
    for (let attempt = 0; attempt <= GEMINI_RETRY_DELAYS_MS.length; attempt++) {
      try {
        console.log(`[gemini] generate model=${model} attempt=${attempt + 1}`);
        return await requestGeminiGenerateContent(model, requestBody);
      } catch (err) {
        errors.push(`${model}#${attempt + 1}: ${err.message}`);
        if (!err.retryable || attempt >= GEMINI_RETRY_DELAYS_MS.length) {
          console.warn(`[gemini] giving up model=${model}: ${err.message}`);
          break;
        }

        const delayMs = GEMINI_RETRY_DELAYS_MS[attempt];
        console.warn(`[gemini] retryable ${err.status || ''}: ${err.message}. wait ${Math.round(delayMs / 1000)}s`);
        await sleep(delayMs);
      }
    }
  }

  throw new Error(`Gemini error after retries: ${errors.join(' | ')}`);
}

async function requestGeminiGenerateContent(model, requestBody) {
  const cleanModel = String(model || DEFAULT_DIARY_GEMINI_MODEL).replace(/^models\//, '');
  const url = `${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(cleanModel)}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.error) {
    const status = data.error?.code || res.status;
    const error = new Error(formatGeminiError(status, data.error || data));
    error.status = status;
    error.retryable = isRetryableGeminiError(status, data.error || data);
    throw error;
  }

  return data;
}

function getDiaryGeminiModels() {
  const models = [
    DIARY_GEMINI_MODEL || DEFAULT_DIARY_GEMINI_MODEL,
    ...parseCommaList(DIARY_GEMINI_FALLBACK_MODELS),
    ...DEFAULT_DIARY_GEMINI_FALLBACK_MODELS,
  ];
  const seen = new Set();
  return models
    .map(model => String(model || '').trim())
    .filter(model => {
      if (!model || seen.has(model)) return false;
      seen.add(model);
      return true;
    });
}

function parseCommaList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function isRetryableGeminiError(status, errorPayload) {
  const text = JSON.stringify(errorPayload || '').toLowerCase();
  return [429, 500, 502, 503, 504].includes(Number(status)) ||
    /unavailable|high demand|overloaded|timeout|temporar|rate limit|quota/.test(text);
}

function formatGeminiError(status, errorPayload) {
  const message = errorPayload?.message || JSON.stringify(errorPayload || {});
  const code = status || errorPayload?.code || 'unknown';
  return `HTTP ${code} ${String(message).replace(/\s+/g, ' ').slice(0, 240)}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function humanizeDiaryText(text) {
  const cleaned = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/```$/g, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // 段落内の改行は保持する（スペースに潰さない）
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map(p => p.replace(/ {2,}/g, ' ').trim())
    .filter(Boolean);

  const breathingParagraphs = paragraphs.flatMap(p => splitParagraphForBreathing(p));
  if (breathingParagraphs.length >= 3) {
    return breathingParagraphs.join('\n\n');
  }

  // フォールバック: 文単位で改行しながら段落を再構築
  const sentences = cleaned
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[。！？])/)
    .map(s => s.trim())
    .filter(Boolean);

  if (sentences.length <= 2) return cleaned;

  const rebuilt = [];
  let current = [];
  let currentLength = 0;
  for (const sentence of sentences) {
    current.push(sentence);
    currentLength += sentence.length;
    if (currentLength >= 130 || current.length >= 3) {
      rebuilt.push(current.join('\n'));
      current = [];
      currentLength = 0;
    }
  }
  if (current.length) rebuilt.push(current.join('\n'));

  return rebuilt.flatMap(p => splitParagraphForBreathing(p)).join('\n\n');
}

function splitParagraphForBreathing(paragraph) {
  const text = String(paragraph || '').trim();

  // Geminiが段落内に改行を入れていればそのまま尊重する
  if (text.includes('\n')) {
    if (text.length <= 300) return [text];
    // 長すぎる場合のみ途中で段落を分割
    const lines = text.split('\n').filter(Boolean);
    const chunks = [];
    let chunk = [];
    let len = 0;
    for (const line of lines) {
      chunk.push(line);
      len += line.length;
      if (len >= 200 && chunk.length >= 2) {
        chunks.push(chunk.join('\n'));
        chunk = [];
        len = 0;
      }
    }
    if (chunk.length) chunks.push(chunk.join('\n'));
    return chunks.filter(Boolean);
  }

  // 改行なしの長い段落: 文単位で改行を入れる
  if (text.length <= 180) return [text].filter(Boolean);

  const sentences = text
    .split(/(?<=[。！？])/)
    .map(s => s.trim())
    .filter(Boolean);
  if (sentences.length <= 2) return [text];

  const chunks = [];
  let current = [];
  let length = 0;
  for (const sentence of sentences) {
    current.push(sentence);
    length += sentence.length;
    if (length >= 160 || current.length >= 3) {
      chunks.push(current.join('\n'));
      current = [];
      length = 0;
    }
  }
  if (current.length) chunks.push(current.join('\n'));

  return chunks.filter(Boolean);
}

function attachDiaryPhoto(diaryText, photo) {
  if (!photo?.url) return diaryText;
  const caption = photo.caption || '今日のトラペル子';
  return [
    `![${caption}](${photo.url})`,
    '',
    caption,
    '',
    diaryText,
  ].join('\n');
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function diaryTextToHtml(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map(p => {
      const lines = p.trim().split('\n').map(l => escapeHtml(l.trim())).filter(Boolean);
      if (!lines.length) return '';
      return `<p>${lines.join('<br>')}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

// ── はてなブログ AtomPub 投稿 ───────────────────────────
async function postToHatenaBlog(date, dateLabel, diaryText) {
  if (!HATENA_ID || !HATENA_BLOG_ID || !HATENA_API_KEY) {
    console.warn('[hatena] credentials not set, skipping post');
    return null;
  }

  const title = `${dateLabel}の日記`;
  const content = diaryTextToHtml(diaryText);

  const atom = `<?xml version="1.0" encoding="utf-8"?>
<entry xmlns="http://www.w3.org/2005/Atom"
       xmlns:app="http://www.w3.org/2007/app">
  <title>${title}</title>
  <content type="text/html">${content}</content>
  <category term="ウイコレ" />
  <category term="eFootball" />
  <category term="日記" />
  <app:control><app:draft>no</app:draft></app:control>
</entry>`;

  const credentials = Buffer.from(`${HATENA_ID}:${HATENA_API_KEY}`).toString('base64');
  const url = `https://blog.hatena.ne.jp/${HATENA_ID}/${HATENA_BLOG_ID}/atom/entry`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Authorization': `Basic ${credentials}`,
    },
    body: atom,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Hatena Blog API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const responseXml = await res.text();
  const postUrl = responseXml.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/)?.[1] || '';
  console.log(`[hatena] posted: ${postUrl}`);
  return postUrl;
}

// ── Firebase アーカイブ ───────────────────────────────────
function initFirebase() {
  if (admin.apps.length) return admin.database();
  const sa = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: FIREBASE_DATABASE_URL });
  return admin.database();
}

async function saveToFirebase(date, diaryText, postUrl, sources, photo) {
  const db = initFirebase();
  const { videos, news, worldCup, musicTopic, nineties, interestTopic, shopItem } = sources;

  // Bot の「今のイベント」返答用サマリ
  const summaryItems = [
    ...news.slice(0, 3).map(n => n.title),
    ...videos.slice(0, 2).map(v => v.title),
    ...(worldCup?.items || []).slice(0, 1).map(v => v.title),
    ...(shopItem ? [`${shopItem.shop}: ${shopItem.item}`] : []),
    ...(musicTopic ? [musicTopic.theme] : []),
    ...(nineties?.title ? [nineties.title] : []),
  ];
  await db.ref('config/uicolleNews').set({
    event:     summaryItems.slice(0, 3).join('\n') || '今日の情報は少なめだったみたい',
    gacha:     '',
    updatedAt: date,
    diary:     diaryText.slice(0, 600),
    blogUrl:   postUrl || '',
    photoUrl:  photo?.url || '',
  });

  // 全文アーカイブ（Bot の長期知識）
  await db.ref(`diary/${date}`).set({
    text:      diaryText,
    blogUrl:   postUrl || '',
    photoUrl:  photo?.url || '',
    sources: {
      news:   news.map(n => n.title),
      videos: videos.map(v => v.title),
      worldCup: (worldCup?.items || []).map(n => n.title),
      musicTopicId: musicTopic?.id || null,
      shopItemId: shopItem?.id || null,
      nineties: nineties?.title ? [nineties.title] : [],
      interestTopicId: interestTopic?.id || null,
    },
    createdAt: Date.now(),
  });

  console.log('[firebase] archived');
}

// ── ローカル blog/ にも保存 ───────────────────────────────
function saveBlogMarkdown(date, dateLabel, diaryText, postUrl) {
  ensureBlogDir();

  const md = [
    `# ${dateLabel}の日記`,
    '',
    postUrl ? `[はてなブログで読む](${postUrl})` : '',
    '',
    diaryText,
    '',
  ].filter(l => l !== undefined).join('\n');

  fs.writeFileSync(path.join(BLOG_DIR, `${date}.md`), md, 'utf8');

  // インデックス更新（最新30件）
  const files = fs.readdirSync(BLOG_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort().reverse().slice(0, 30);

  const index = [
    '# 秘書トラペル子の日記',
    '',
    '毎日のウイコレ情報と、私の思ったことをここに残してるよ。',
    '',
    ...files.map(f => {
      const d = f.replace('.md', '');
      const [y, m, day] = d.split('-');
      return `- [${y}年${m}月${day}日](./${f})`;
    }),
  ].join('\n');

  fs.writeFileSync(path.join(BLOG_DIR, 'index.md'), index, 'utf8');
  console.log(`[blog] saved ${date}.md, updated index`);
}

// ── メイン ────────────────────────────────────────────────
async function main() {
  const date = getJSTDate();
  const dateLabel = getJSTDateLabel();
  const state = loadDiaryState();
  await hydrateStateFromFirebase(state);
  console.log(`[diary] start ${date}`);

  const [videos, news] = await Promise.all([
    fetchYouTubeVideos().catch(e => { console.error('[youtube]', e.message); return []; }),
    fetchEfootballNews().catch(e => { console.error('[rss]',     e.message); return []; }),
  ]);
  console.log(`[diary] youtube=${videos.length} news=${news.length}`);

  const youtube = analyzeYouTubeFreshness(videos, state);
  if (youtube.repeated) console.log('[youtube] same as previous diary, skipping video focus');

  const [worldCup, groupHighlights] = await Promise.all([
    fetchWorldCupUpdates(date, state).catch(e => {
      console.error('[worldcup]', e.message);
      return { active: false, items: [], note: '取得に失敗したので触れない。' };
    }),
    fetchGroupChatHighlights().catch(e => {
      console.error('[group]', e.message);
      return { messages: [], note: 'グループ会話の取得に失敗した。' };
    }),
  ]);
  const musicTopic = selectMusicTopic(state);
  const nineties = selectNinetiesTopic(state);
  const interestTopic = selectInterestTopic(state);
  const shopItem = selectShopItemTopic(state);
  console.log(`[diary] worldCup=${worldCup.items.length} shopItem=${shopItem?.id || 'none'} music=${musicTopic?.id || 'none(weekly gate)'} nineties=${nineties?.title || 'none'} interest=${interestTopic?.id || 'none'} group=${groupHighlights.messages.length} gameEvent=${groupHighlights.hasGameEvent || false}`);

  const storyPlan = selectStoryPlan(state);
  console.log(`[story] ${storyPlan.motifId} phase=${storyPlan.phaseIndex + 1}${storyPlan.isFinal ? ' final' : ''}`);

  const inputs = {
    youtube,
    news,
    worldCup,
    musicTopic,
    nineties,
    storyPlan,
    interestTopic,
    groupHighlights,
    shopItem,
  };

  const photo = getDiaryPhoto();
  if (photo) console.log(`[photo] using ${photo.url}`);

  const diaryBody = await generateDiary(dateLabel, inputs);
  const diaryText = attachDiaryPhoto(diaryBody, photo);
  console.log(`[diary] generated ${diaryText.length}chars`);

  const postUrl = await postToHatenaBlog(date, dateLabel, diaryText)
    .catch(e => { console.error('[hatena]', e.message); return null; });

  saveBlogMarkdown(date, dateLabel, diaryText, postUrl);

  if (FIREBASE_SERVICE_ACCOUNT && FIREBASE_DATABASE_URL) {
    await saveToFirebase(date, diaryText, postUrl, {
      videos: youtube.videosForDiary,
      news,
      worldCup,
      musicTopic,
      nineties,
      interestTopic,
      shopItem,
    }, photo)
      .catch(e => console.error('[firebase]', e.message));
  }

  updateDiaryStateAfterSuccess(state, date, inputs);
  saveDiaryState(state);

  console.log('[diary] done');
  process.exit(0);
}

main().catch(e => { console.error('[diary] fatal', e); process.exit(1); });
