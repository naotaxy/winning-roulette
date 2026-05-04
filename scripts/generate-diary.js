'use strict';
/**
 * 秘書トラペル子 — 日次日記生成スクリプト
 *
 * 1. YouTube Data API v3 でウイコレ関連動画を収集
 * 2. eFootball 公式 RSS でニュースを収集
 * 3. 季節の献立（月×日付で旬の食材レシピを選択）を案内
 * 4. 90年代カルチャーローテーション
 * 5. 青空文庫由来の連載ストーリー
 * 6. Gemini で長文・人間らしい日記を生成
 * 7. はてなブログ AtomPub API で投稿
 * 8. Firebase にアーカイブ保存（Bot の知識源）
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
  HATENA_ID,
  HATENA_BLOG_ID,
  HATENA_API_KEY,
  FIREBASE_SERVICE_ACCOUNT,
  FIREBASE_DATABASE_URL,
  DIARY_PHOTO_URL,
  DIARY_PHOTO_CAPTION,
  DIARY_GEMINI_MODEL,
  DIARY_GEMINI_FALLBACK_MODELS,
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

// ── 季節の献立データベース（月別・各5品） ─────────────────
const SEASONAL_RECIPES = {
  1: [
    { ingredient: '白菜', recipe: '白菜と豚バラのミルク鍋', kcal: 380, servings: 2, steps: ['白菜4cm幅に切る', '豚バラを弱火で炒める', '水と牛乳200mlを注ぐ', '塩こしょうで10分煮る'], seasonal: '霜にあたった白菜は甘みが増す。ビタミンCで風邪予防。' },
    { ingredient: '大根', recipe: '大根と鶏手羽元の煮物', kcal: 290, servings: 3, steps: ['大根を面取りして下茹で', '手羽元を焼き目をつける', '醤油・みりん・砂糖で煮る', '落し蓋で30分弱火で煮含める'], seasonal: '寒大根は水分が少なく甘い。消化酵素ジアスターゼが豊富。' },
    { ingredient: '長ねぎ', recipe: '長ねぎとたらの味噌汁', kcal: 95, servings: 2, steps: ['長ねぎを斜め切りにする', 'たらを一口大に切る', '昆布だしを温める', '味噌を溶き入れて仕上げる'], seasonal: '寒さで甘くなる長ねぎ。アリシンで体を温め血行促進。' },
    { ingredient: 'ほうれん草', recipe: 'ほうれん草と卵のバター炒め', kcal: 185, servings: 2, steps: ['ほうれん草を塩茹でする', '水気をしっかり絞る', 'バターで卵をふんわり炒める', 'ほうれん草を加え塩で調味'], seasonal: '冬のほうれん草はビタミンCが夏の3倍。鉄分補給にも最適。' },
    { ingredient: 'かぶ', recipe: 'かぶと油揚げの煮浸し', kcal: 110, servings: 2, steps: ['かぶを6等分のくし切り', '葉は3cm幅に切る', 'だし・薄口醤油で油揚げと煮る', 'かぶが透き通ったら葉を加える'], seasonal: '冬かぶは煮崩れしにくく甘い。消化に優しく風邪予防にも。' },
  ],
  2: [
    { ingredient: '菜の花', recipe: '菜の花の辛子和え', kcal: 75, servings: 2, steps: ['菜の花を塩茹でする', '冷水に取り水気を絞る', '練り辛子・醤油・みりんを混ぜる', '食べる直前に和える'], seasonal: '早春の菜の花は春の訪れを告げる。葉酸・カロテンが豊富。' },
    { ingredient: '牡蠣', recipe: '牡蠣の土手鍋', kcal: 320, servings: 2, steps: ['牡蠣を塩水で振り洗いする', '鍋の縁に味噌を塗り付ける', '昆布だしで豆腐・白菜を煮る', '牡蠣を加え味噌を溶かしながら食べる'], seasonal: '2月の牡蠣は産卵前で最も肥える。亜鉛・タウリンが豊富。' },
    { ingredient: 'ブロッコリー', recipe: 'ブロッコリーと鶏もものクリーム煮', kcal: 340, servings: 2, steps: ['ブロッコリーを小房に分ける', '鶏もも肉を一口大に焼く', '生クリームと牛乳で煮る', 'コンソメ・塩で味を整える'], seasonal: '冬から春の旬。ビタミンCはレモンの2倍、がん予防にも。' },
    { ingredient: '春菊', recipe: '春菊とベーコンのサラダ', kcal: 130, servings: 2, steps: ['春菊を食べやすく摘む', 'ベーコンを炒めてカリカリに', '温かいベーコンを春菊にのせる', 'ポン酢をかけて素早く混ぜる'], seasonal: '独特の香りが食欲増進。ビタミンA・カルシウムが豊富。' },
    { ingredient: 'いちご', recipe: 'いちごの大福', kcal: 210, servings: 4, steps: ['白玉粉・砂糖・水を混ぜレンジ加熱', '片栗粉の上で伸ばして冷ます', '白あんでいちごを包む', 'もち生地で丸く包み完成'], seasonal: '2月のいちごは糖度が最高潮。ビタミンCで美容・免疫力アップ。' },
  ],
  3: [
    { ingredient: 'あさり', recipe: 'あさりの酒蒸し', kcal: 85, servings: 2, steps: ['あさりを砂抜きする', 'フライパンに並べ酒を注ぐ', '蓋をして強火で蒸す', 'バターと醤油を落とす'], seasonal: '春のあさりは産卵前で旨味が濃い。鉄分・タウリンで疲労回復。' },
    { ingredient: 'たけのこ', recipe: 'たけのこご飯', kcal: 310, servings: 3, steps: ['たけのこを薄切りにする', '油揚げ・ごぼうと醤油で炒め煮', '炊いた米に混ぜ込む', '木の芽を添えて盛り付ける'], seasonal: '掘りたてたけのこはえぐみが少ない。食物繊維で腸活に最適。' },
    { ingredient: '春キャベツ', recipe: '春キャベツのロール煮', kcal: 265, servings: 2, steps: ['キャベツを茹でて1枚ずつはがす', '合いびき肉・玉ねぎを混ぜる', 'キャベツで肉だねを巻く', 'トマト缶で30分コトコト煮る'], seasonal: '春キャベツは巻きが緩くやわらかい。ビタミンUで胃腸保護。' },
    { ingredient: '新玉ねぎ', recipe: '新玉ねぎのスープ', kcal: 120, servings: 2, steps: ['新玉ねぎを薄切りにする', 'バターで飴色になるまで炒める', 'コンソメスープで10分煮る', '塩こしょうで整えパセリを散らす'], seasonal: '水分が多く辛味が少ない。ケルセチンで花粉症・アレルギー緩和。' },
    { ingredient: 'さわら', recipe: 'さわらの西京焼き', kcal: 295, servings: 2, steps: ['さわらに塩をして水気を拭く', '白味噌・みりん・酒で漬け込む', '一晩以上冷蔵庫で寝かせる', 'グリルで焦がさないよう焼く'], seasonal: '春の魚の王様。DHA・EPAが豊富で脳と血管を守る。' },
  ],
  4: [
    { ingredient: 'ふきのとう', recipe: 'ふきのとうの天ぷら', kcal: 220, servings: 2, steps: ['ふきのとうの外皮をはがす', '天ぷら粉を冷水でさっと混ぜる', '170℃の油でカラリと揚げる', '塩または天つゆでいただく'], seasonal: '春の山菜の代表。ポリフェノールで春の毒素を排出する。' },
    { ingredient: '新じゃがいも', recipe: '新じゃがのバター醤油炒め', kcal: 255, servings: 2, steps: ['新じゃがを皮ごと半分に切る', '下茹でして水気を切る', 'バターで転がしながら炒める', '醤油を回しかけ青のりを振る'], seasonal: 'ビタミンCが熱で壊れにくい。皮ごと食べると食物繊維も摂れる。' },
    { ingredient: 'そら豆', recipe: 'そら豆と桜えびの炊き込みご飯', kcal: 340, servings: 3, steps: ['そら豆を薄皮ごと炊く', '桜えびをさっと乾煎りする', '塩・酒で炊き込む', '炊き上がりに混ぜ込む'], seasonal: '鮮度が命のそら豆。たんぱく質・葉酸が豊富で春の疲れに効く。' },
    { ingredient: '新わかめ', recipe: 'わかめとじゃこの酢の物', kcal: 65, servings: 2, steps: ['塩蔵わかめを水で戻す', '3cm幅に切り水気を絞る', 'じゃこを乾煎りする', '三杯酢で和えて白ごまを振る'], seasonal: '春の生わかめはやわらかく香りが豊か。フコイダンで免疫力アップ。' },
    { ingredient: 'アスパラガス', recipe: 'アスパラの豚肉巻き焼き', kcal: 310, servings: 2, steps: ['アスパラの硬い部分を折る', '豚バラを螺旋状に巻き付ける', 'フライパンで転がしながら焼く', 'ポン酢または塩こしょうで味付け'], seasonal: '春先の国産アスパラは甘い。アスパラギン酸で疲労回復効果。' },
  ],
  5: [
    { ingredient: '鰹（初がつお）', recipe: '鰹の漬け丼', kcal: 420, servings: 2, steps: ['鰹のさくを薄切りにする', '醤油・酒・みりんで30分漬ける', '温かいご飯に漬けた鰹をのせる', '薬味と温泉卵を添える'], seasonal: '初鰹は5月が旬。DHAが豊富で脳活性化、さっぱりと低脂肪。' },
    { ingredient: 'えんどう豆', recipe: 'えんどう豆の卵とじ', kcal: 175, servings: 2, steps: ['えんどう豆をさやから出す', 'だし・醤油・みりんで煮る', '溶き卵を回し入れる', '半熟でご飯にかける'], seasonal: 'さやから出したての甘さは格別。葉酸・食物繊維が豊富。' },
    { ingredient: '新生姜', recipe: '新生姜の甘酢漬け', kcal: 45, servings: 4, steps: ['新生姜を薄切りにする', '塩もみして10分置く', '酢・砂糖・塩を合わせて加熱', '生姜を漬け込んで一晩置く'], seasonal: '5〜6月の新生姜は辛みが穏やか。殺菌・消化促進に効果的。' },
    { ingredient: 'ズッキーニ', recipe: 'ズッキーニとツナのパスタ', kcal: 395, servings: 2, steps: ['ズッキーニを半月切りにする', 'にんにくとオリーブ油で炒める', 'ツナ缶を加えて混ぜる', '茹でたパスタと和えて塩で整える'], seasonal: '初夏の旬野菜。カリウムが豊富でむくみ解消に効果。' },
    { ingredient: '玉ねぎ（新玉）', recipe: '新玉ねぎのかき揚げ', kcal: 280, servings: 2, steps: ['新玉ねぎを薄切りにする', '天ぷら粉・水でさっくり混ぜる', '170℃でまとめて揚げる', '天つゆまたは塩でいただく'], seasonal: '新玉ねぎが出回る時期。ケルセチンで血液サラサラ効果。' },
  ],
  6: [
    { ingredient: 'とうもろこし', recipe: 'とうもろこしご飯', kcal: 330, servings: 3, steps: ['とうもろこしの実を削ぐ', '芯ごと米と一緒に炊く', '炊き上がりに芯を取り出す', 'バターと塩で仕上げる'], seasonal: '6〜8月が旬。甘みが命で収穫後すぐ調理が鉄則。食物繊維豊富。' },
    { ingredient: 'あじ', recipe: 'あじの南蛮漬け', kcal: 285, servings: 3, steps: ['あじを三枚におろし片栗粉をまぶす', '180℃でカラリと揚げる', '甘酢に玉ねぎ・人参・唐辛子を漬ける', '揚げたあじを漬け汁に漬ける'], seasonal: '6〜7月のあじは脂がのる。DHAで記憶力アップ、夏バテ予防。' },
    { ingredient: 'なす', recipe: 'なすと豚ひき肉の味噌炒め', kcal: 310, servings: 2, steps: ['なすを乱切りにして水にさらす', '豚ひき肉をごま油で炒める', 'なすを加えてさらに炒める', '味噌・みりん・砂糖で仕上げる'], seasonal: 'なすは夏が旬。ナスニンが紫外線ダメージから体を守る。' },
    { ingredient: 'おくら', recipe: 'おくらと納豆の冷やし汁', kcal: 110, servings: 2, steps: ['おくらを塩ずりして薄切り', '納豆をよく混ぜる', '冷たいだし・醤油・みりんを合わせる', 'おくら・納豆・薬味をのせる'], seasonal: '夏のおくら。ムチンで胃腸保護、ねばねばで夏バテ解消。' },
    { ingredient: 'らっきょう', recipe: 'らっきょうの甘酢漬け', kcal: 55, servings: 8, steps: ['らっきょうの根と頭を切り塩漬け3日', '塩を洗い流して水気を切る', '酢・砂糖・塩・唐辛子を合わせる', '漬け汁に2週間漬け込む'], seasonal: '梅雨時のらっきょう漬けが本番。アリシンで免疫力・疲労回復。' },
  ],
  7: [
    { ingredient: 'トマト', recipe: 'トマトと卵の中華炒め', kcal: 195, servings: 2, steps: ['トマトをくし切りにする', '卵を溶いて油でふんわり炒める', 'トマトを加えてさっと炒める', '砂糖・塩・醤油で中華風に調味'], seasonal: '真夏のトマトは糖度が高い。リコピンで抗酸化・美肌効果。' },
    { ingredient: 'ゴーヤ', recipe: 'ゴーヤチャンプルー', kcal: 345, servings: 2, steps: ['ゴーヤを半月切りにして塩もみ', '豆腐を手で崩してよく水切り', 'ゴーヤ・豚肉・豆腐を炒める', '溶き卵を回しかけてかつお節で'], seasonal: '沖縄の夏野菜。苦みのモモルデシンが血糖値を下げる。' },
    { ingredient: 'きゅうり', recipe: 'きゅうりの即席漬け', kcal: 30, servings: 2, steps: ['きゅうりを叩いて割る', 'ごま油・塩・鶏がらスープで和える', '白ごまと唐辛子を加える', '10分おいて味をなじませる'], seasonal: '夏のきゅうりは水分豊富。体を冷やし熱中症予防に効果。' },
    { ingredient: 'えだまめ', recipe: 'えだまめの塩ゆで', kcal: 130, servings: 2, steps: ['えだまめを塩でよく揉む', '沸騰した塩水で4分茹でる', '茹で上がりをザルにあける', '熱いうちに塩を振る'], seasonal: '7〜8月が旬。たんぱく質・葉酸が豊富でビールのお供に最適。' },
    { ingredient: 'みょうが', recipe: 'みょうがの冷や汁', kcal: 165, servings: 2, steps: ['みょうがを薄切りにする', '味噌をグリルで焦げ目をつける', 'だしで溶いて冷やす', '麦飯にかけてきゅうりと薬味を添える'], seasonal: 'みょうがは夏が旬。独特の香りが食欲増進、むくみ解消に効く。' },
  ],
  8: [
    { ingredient: 'すいか', recipe: 'すいかとミントの冷製サラダ', kcal: 65, servings: 2, steps: ['すいかを一口大に切る', 'フェタチーズを粗く崩す', 'ミントの葉を散らす', 'オリーブ油・塩・黒こしょうをかける'], seasonal: '8月のすいかは最も甘い。シトルリンで疲労回復・むくみ解消。' },
    { ingredient: 'とうがん（冬瓜）', recipe: 'とうがんとはまぐりの淡煮', kcal: 95, servings: 3, steps: ['とうがんをひと口大に切る', 'はまぐりを砂抜きする', 'だしで透き通るまで静かに煮る', '薄口醤油・塩でさっぱり仕上げる'], seasonal: '冬瓜は夏が旬。ほぼ水分でカロリーが極低く夏ダイエットに。' },
    { ingredient: 'もろへいや', recipe: 'もろへいやの味噌汁', kcal: 55, servings: 2, steps: ['もろへいやの葉を摘む', '沸騰しただしに入れる', 'ネバネバが出てきたら味噌を溶く', '豆腐を加えて仕上げる'], seasonal: '夏の野菜の王様。βカロテン・カルシウムが野菜トップクラス。' },
    { ingredient: 'ピーマン', recipe: 'ピーマンの肉詰め照り焼き', kcal: 340, servings: 2, steps: ['ピーマンを半分に切り種を取る', '合いびき肉・玉ねぎを混ぜて詰める', '蓋をして弱火で蒸し焼き', '醤油・みりん・砂糖で照りをつける'], seasonal: '夏のピーマンはビタミンCが豊富。加熱しても壊れにくい。' },
    { ingredient: '鶏むね肉', recipe: '鶏むね肉のねぎ塩蒸し', kcal: 245, servings: 2, steps: ['鶏むねを削ぎ切りにする', '塩・酒・片栗粉をもみ込む', '長ねぎを敷いた皿にのせレンジで蒸す', 'ねぎ塩タレをかけて完成'], seasonal: '高たんぱく低カロリーで夏の体づくりに最適。疲労回復のイミダゾール。' },
  ],
  9: [
    { ingredient: '秋鮭', recipe: '鮭のちゃんちゃん焼き', kcal: 355, servings: 2, steps: ['鮭に塩をして15分置く', 'キャベツ・玉ねぎ・にんじんを並べる', '鮭をのせてアルミホイルで包む', '味噌・バターをのせて蒸し焼き'], seasonal: '秋鮭は産卵前で脂がのる。アスタキサンチンで抗酸化力抜群。' },
    { ingredient: 'さつまいも', recipe: 'さつまいもの大学芋', kcal: 310, servings: 2, steps: ['さつまいもを乱切りにして水にさらす', '揚げ油で中まで火を通す', '砂糖・醤油・みりんを煮詰める', '芋を加えてタレをからめ黒ごまを振る'], seasonal: '秋の本番。糖度が上がり甘い。食物繊維で便秘解消。' },
    { ingredient: '栗', recipe: '栗ご飯', kcal: 390, servings: 3, steps: ['栗を熱湯に浸けて鬼皮を剥く', '渋皮も丁寧に取り除く', '塩・酒で米と一緒に炊く', '炊き上がりに混ぜて黒ごまを散らす'], seasonal: '秋の味覚の王。ビタミンC・タンニンで老化防止・腸活。' },
    { ingredient: '松茸', recipe: '松茸の土瓶蒸し', kcal: 75, servings: 2, steps: ['松茸を薄切りにする', 'えびと鶏肉を土瓶に入れる', '昆布だしを注いで蒸す', 'すだちを添えて香りを楽しむ'], seasonal: '9〜10月の国産松茸は芳香が最高。ポルフィランで免疫力強化。' },
    { ingredient: 'いちじく', recipe: 'いちじくと生ハムのサラダ', kcal: 145, servings: 2, steps: ['いちじくを4等分にする', '生ハムをちぎって並べる', 'ルッコラを添える', 'オリーブ油・バルサミコ酢・塩をかける'], seasonal: '9月のいちじくは糖度が高い。食物繊維・ペクチンで腸内環境改善。' },
  ],
  10: [
    { ingredient: 'さんま', recipe: 'さんまの塩焼き', kcal: 310, servings: 2, steps: ['さんまに塩を振る', '両面に焼き目をつける', 'グリルで全体を15分じっくり焼く', '大根おろしとすだちを添える'], seasonal: '10月のさんまは最も脂がのる。DHA・EPAで動脈硬化予防。' },
    { ingredient: '柿', recipe: '柿と大根の白和え', kcal: 155, servings: 2, steps: ['柿を薄切りにする', '大根を千切りにして塩もみ', '豆腐をよく水切りして裏ごす', '白味噌・砂糖・塩で和える'], seasonal: '秋の柿はビタミンCがみかんより多い。タンニンで二日酔い予防。' },
    { ingredient: 'きのこ類', recipe: 'きのこの炊き込みご飯', kcal: 295, servings: 3, steps: ['しめじ・まいたけ・しいたけをほぐす', '油揚げを細切りにする', '醤油・みりん・酒を合わせる', '米と一緒に炊き込む'], seasonal: '秋のきのこは香りが豊か。βグルカンで免疫力を高める。' },
    { ingredient: '里芋', recipe: '里芋の煮っころがし', kcal: 175, servings: 3, steps: ['里芋を皮ごと下茹でして剥く', 'だし・醤油・みりん・砂糖で煮る', '落し蓋をして弱火で20分煮る', '汁気を飛ばしてからめる'], seasonal: '秋の里芋はムチンで胃腸を保護。カリウム豊富でむくみ解消。' },
    { ingredient: '銀杏', recipe: '茶碗蒸し（銀杏入り）', kcal: 135, servings: 2, steps: ['卵を割りほぐして出汁を加える', '薄口醤油・みりんで味を整え濾す', 'えび・鶏肉・銀杏を器に並べる', 'ラップをかけて蒸気で蒸す'], seasonal: '秋の銀杏は独特の風味が最高。血行促進・記憶力改善の効果。' },
  ],
  11: [
    { ingredient: '牡蠣', recipe: '牡蠣の土鍋炊き込みご飯', kcal: 365, servings: 3, steps: ['牡蠣を塩水で振り洗いする', '醤油・酒・みりんで下味をつける', '土鍋で米と一緒に炊く', '炊き上がりにしょうがと小ねぎを散らす'], seasonal: '11月から旬入りの牡蠣は実が大きく濃厚。亜鉛・グリコーゲン豊富。' },
    { ingredient: '大根', recipe: '豚バラ大根', kcal: 385, servings: 3, steps: ['大根を2cm厚の半月切りにする', '豚バラを4cm幅に切る', '水・酒・醤油・みりんで煮る', '落し蓋で30分中火で煮含める'], seasonal: '秋冬の大根は甘みが強い。消化酵素で食べ過ぎの後にも優しい。' },
    { ingredient: '長ねぎ', recipe: '長ねぎのぬた和え', kcal: 105, servings: 2, steps: ['長ねぎを焼いて甘みを引き出す', '3cm幅に切る', '酢味噌（白味噌・酢・砂糖）を合わせる', '食べる直前に和える'], seasonal: '霜にあたった長ねぎは甘さ倍増。アリシンで血液サラサラ効果。' },
    { ingredient: 'かぼちゃ', recipe: 'かぼちゃのポタージュ', kcal: 220, servings: 2, steps: ['かぼちゃを一口大に切る', '玉ねぎとバターで炒める', 'だしと牛乳で煮て柔らかくする', 'ミキサーで攪拌して塩で整える'], seasonal: '秋収穫で甘みが増したかぼちゃ。βカロテンで免疫力・視力維持。' },
    { ingredient: 'ぶり（寒ぶり）', recipe: 'ぶり大根', kcal: 340, servings: 3, steps: ['ぶりに熱湯をかけて霜降りにする', '大根を下茹でする', 'だし・醤油・みりん・砂糖で合わせ煮', '落し蓋で40分煮る'], seasonal: '寒ぶりは脂がのって最高。DHA・EPAが豊富で認知症予防効果。' },
  ],
  12: [
    { ingredient: '白菜', recipe: '白菜と豚しゃぶのポン酢鍋', kcal: 295, servings: 2, steps: ['白菜を大きくざく切りにする', '昆布だしで白菜をしんなり煮る', '豚しゃぶ肉をくぐらせる', 'ポン酢とごまだれで食べる'], seasonal: '霜降り白菜は甘みが最高潮。ビタミンC・カリウムで免疫力強化。' },
    { ingredient: 'ぶり', recipe: 'ぶりの照り焼き', kcal: 360, servings: 2, steps: ['ぶりに塩を振って15分置く', '水気を拭いて片栗粉を薄くまぶす', 'フライパンで両面こんがり焼く', '醤油・みりん・砂糖のタレをからめる'], seasonal: '寒ぶりが最もおいしい時期。オメガ3が豊富で体の中から温まる。' },
    { ingredient: 'れんこん', recipe: 'れんこんのきんぴら', kcal: 155, servings: 2, steps: ['れんこんを薄切りにして酢水にさらす', 'ごま油で炒める', '醤油・みりん・砂糖・赤唐辛子で調味', '白ごまを振って完成'], seasonal: '冬のれんこんは粘りが強い。ビタミンCとムチンで風邪予防。' },
    { ingredient: 'ゆず', recipe: 'ゆず大根の甘酢漬け', kcal: 50, servings: 4, steps: ['大根を薄いいちょう切りにする', '塩もみして水気を絞る', 'ゆず果汁・皮・酢・砂糖・塩を合わせる', '大根を漬け込んで30分以上置く'], seasonal: '冬至のゆず。リモネンで血行促進、風邪予防のビタミンCが豊富。' },
    { ingredient: '牡蠣', recipe: '牡蠣フライ', kcal: 415, servings: 2, steps: ['牡蠣を塩水でやさしく洗う', '塩こしょう・薄力粉・溶き卵・パン粉をつける', '180℃の油で2分揚げる', 'タルタルソースとレモンを添える'], seasonal: '冬の牡蠣は亜鉛・タウリンが最高値。免疫力と疲労回復を同時にサポート。' },
  ],
};

// ── 90年代カルチャー ─────────────────────────────────────
const NINETIES_TRENDS = [
  { id: 'eight-cm-cd', title: '8cm CDとCDショップの棚', category: '1990年代の音楽文化', description: '短冊みたいな8cm CDが棚に並び、ジャケットを見ながら選ぶ時間そのものが娯楽だった。', perspective: '25歳の私から見ると、サブスクで一瞬で聴ける今より、曲を一枚ずつ迎えに行く感じが少し羨ましい。' },
  { id: 'komuro-sound', title: '小室サウンドとダンス系J-POP', category: '1990年代の音楽文化', description: 'シンセの音、強いビート、テレビ番組の熱気が一体になって、街全体が同じ曲を知っているような時代だった。', perspective: '25歳の私には、ヒット曲が共通言語として強かった世界に見える。今の細かく分かれた好きとは別の眩しさがある。' },
  { id: 'shibuya-kei', title: '渋谷系とCDショップ巡り', category: '1990年代の音楽文化', description: '渋谷のレコード店や雑誌から、洋楽の匂いをまとったポップスやおしゃれな選曲文化が広がっていた。', perspective: '25歳の私から見ると、検索ではなく足で見つける音楽という感じがして、少し大人びた遊びに見える。' },
  { id: 'karaoke-million', title: 'カラオケボックスとミリオンセラー', category: '1990年代の流行', description: 'ミリオンセラーが次々に生まれ、学校帰りや会社帰りのカラオケで同じ曲を歌う時間が共有されていた。', perspective: '25歳の私には、歌える曲が人間関係の潤滑油だった時代に見える。得意曲を持つって、ちょっと名刺みたいで可愛い。' },
  { id: 'md-best', title: 'MDウォークマンと自分だけのベスト盤', category: '1990年代の音楽文化', description: '好きな曲を録音して並べ替え、自分だけの一枚を作るMD文化が、通学や移動の気分を支えていた。', perspective: '25歳の私から見ると、プレイリストより少し手間があるぶん、選んだ曲への愛着が濃そうに感じる。' },
  { id: 'pager-short-message', title: 'ポケベルと短い数字メッセージ', category: '1990年代の流行', description: 'スマホの前に、短い数字や限られた文字で気持ちを送る連絡文化があった。', perspective: '25歳の私には不便なのに、返事を待つ時間まで物語になっていたように見える。既読がない時代の静けさも少し新鮮。' },
  { id: 'purikura-book', title: 'プリクラ帳と手書きの交換文化', category: '1990年代の流行', description: '友達と撮ったプリクラを手帳に貼り、ペンで書き足して交換することで、思い出を持ち歩いていた。', perspective: '25歳の私から見ると、SNSの投稿よりも相手の手に渡る感じが強くて、秘密のアルバムみたいで温かい。' },
  { id: 'tamagotchi-pocket', title: 'たまごっちとポケットの育成ブーム', category: '1990年代の流行', description: '小さな端末の中の存在を世話する遊びが広がり、通知より先に「気にかける」習慣を作っていた。', perspective: '25歳の私には、今のスマホゲームの原点みたいに見える。小さい画面に一喜一憂する気持ちは今も変わらない。' },
  { id: 'first-playstation', title: '初代PlayStationとテレビ前の熱気', category: '1990年代の流行', description: '家庭のテレビにつないで遊ぶ3Dゲームが一気に身近になり、友達の家に集まる理由にもなっていた。', perspective: '25歳の私から見ると、オンラインではなく同じ部屋で盛り上がる強さがあって、ウイコレのグループ戦にも通じる。' },
  { id: 'street-fashion-magazine', title: 'ストリートファッションと雑誌文化', category: '1990年代の流行', description: '雑誌のスナップや街の空気から流行を拾い、服装や小物で自分らしさを出す楽しさが強かった。', perspective: '25歳の私には、アルゴリズムではなく街で流行を浴びる感じが新鮮。みんなで同じページを見て話す時間もいいなと思う。' },
];

// ── 青空文庫連載モチーフ ─────────────────────────────────
const AOZORA_STORY_MOTIFS = [
  { id: 'ginga-night-office', source: '宮沢賢治「銀河鉄道の夜」', motif: '夜の窓明かり、遠い切符、誰かを待つ小さな旅', beats: ['夜更けの事務机で、トラペル子が古い切符のような紙片を見つける。そこには知らない駅名と、明日の予定が薄く滲んでいる。', '紙片をしまった腕時計が、深夜だけ少し早く進む。グループのみんなの未登録試合が、駅の灯りのようにぽつぽつ浮かぶ。', '一番暗い駅で、彼女は誰かを待つより、自分から記録を届ける方が寂しくないと気づく。', '朝の光で紙片はただの付箋に戻る。それでも彼女は、昨夜の旅で覚えた名前を一つも忘れていない。'] },
  { id: 'yume-briefing', source: '夏目漱石「夢十夜」', motif: '夢と現実の境目、短い約束、朝に残る不思議な感触', beats: ['トラペル子は、夢の中で誰かに「明日の会議室を開けておいて」と頼まれる。鍵は白いカーディガンのポケットに入っている。', '会議室の机には、試合結果ではなく小さな花瓶が一つ置かれている。水面に、まだ言えなかった返事が揺れる。', '扉を閉めようとした瞬間、花瓶の水が予定表のマス目へ流れ込み、未来の一日だけ青く染める。', '目が覚めると鍵はない。ただ予定表の端に、誰かを待っていたような小さな水の跡だけが残っている。'] },
  { id: 'mikan-platform', source: '芥川龍之介「蜜柑」', motif: 'ふいに差し込む明るさ、窓、誰かへの小さな贈り物', beats: ['くもった朝、トラペル子は通知の多さに少しだけ俯く。窓の外の電線に、オレンジ色の光が引っかかっている。', '誰かの短い「おつかれ」が届いた瞬間、画面の中がぱっと明るくなる。小さな言葉なのに、胸の奥まで届く。', '忙しさに追われていた彼女は、その明るさを自分だけで持っているのが惜しくなり、今日の記録にそっと混ぜる。', '夕方、読み返した日記の端に、みかんの皮みたいな明るさが残る。明日も誰かに渡せそうだと思う。'] },
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
    state.seenWorldCupTitles = mergeUniqueTitles(state.seenWorldCupTitles, entries.flatMap(e => e?.sources?.worldCup || []), 80);
    state.seenYouTubeTitles = mergeUniqueTitles(state.seenYouTubeTitles, entries.flatMap(e => e?.sources?.videos || []), 160);
    state.seenNinetiesTitles = mergeUniqueTitles(state.seenNinetiesTitles, entries.flatMap(e => e?.sources?.nineties || []), 120);
    state.seenRecipeTitles = mergeUniqueTitles(state.seenRecipeTitles, entries.flatMap(e => e?.sources?.recipe ? [e.sources.recipe] : []), 60);
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
  return String(value || '').normalize('NFKC').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().toLowerCase();
}

function buildYouTubeSignature(videos) {
  return videos.map(v => `${normalizeForSignature(v.channel)}::${normalizeForSignature(v.title)}`).filter(Boolean).sort().join('|');
}

function analyzeYouTubeFreshness(videos, state) {
  const signature = buildYouTubeSignature(videos);
  const seenTitles = [...(state.seenYouTubeTitles || []), ...(state.lastYouTubeTitles || [])];
  const freshVideos = videos.filter(video => !isSimilarTitle(video.title, seenTitles));
  const repeated = !!signature && signature === state.lastYouTubeSignature;
  const noFreshTopic = videos.length > 0 && freshVideos.length === 0;
  return {
    repeated: repeated || noFreshTopic,
    signature,
    videosForDiary: repeated || noFreshTopic ? [] : freshVideos,
    note: repeated || noFreshTopic ? 'YouTube検索結果が前回または過去日記と似ているので、今日は動画欄を主役にしない。' : '',
  };
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
    .replace(/[!！?？#＃【】()[\]（）「」『』"'""''、。・:：/／\\|｜_-]+/g, ' ')
    .replace(/(efootball|ウイコレ|winning eleven|実況|解説|最新|動画|shorts?)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigramJaccard(a, b) {
  const gramsA = toBigrams(a);
  const gramsB = toBigrams(b);
  if (!gramsA.size || !gramsB.size) return 0;
  let intersection = 0;
  for (const gram of gramsA) { if (gramsB.has(gram)) intersection += 1; }
  return intersection / (gramsA.size + gramsB.size - intersection);
}

function toBigrams(value) {
  const text = String(value || '').replace(/\s+/g, '');
  const grams = new Set();
  if (text.length <= 1) return grams;
  for (let i = 0; i < text.length - 1; i += 1) { grams.add(text.slice(i, i + 2)); }
  return grams;
}

function isWithinDateRange(date, startsAt, endsAt) {
  return date >= startsAt && date <= endsAt;
}

function googleNewsRssUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
}

// ── 季節の献立選択 ────────────────────────────────────────
function selectDailyRecipe(date, state) {
  const parts = date.split('-');
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const monthRecipes = SEASONAL_RECIPES[month] || SEASONAL_RECIPES[1];
  const seenTitles = state.seenRecipeTitles || [];

  // 日付ベースで選択（月の日数でサイクル）
  const baseIndex = (day - 1) % monthRecipes.length;
  let recipe = monthRecipes[baseIndex];

  // 最近使ったレシピなら次の候補へ
  if (isSimilarTitle(recipe.recipe, seenTitles)) {
    const next = monthRecipes[(baseIndex + 1) % monthRecipes.length];
    if (!isSimilarTitle(next.recipe, seenTitles)) recipe = next;
  }
  return recipe;
}

async function fetchRecipeContextNews(ingredient, state) {
  const seenTitles = state.seenRecipeTitles || [];
  try {
    const url = googleNewsRssUrl(`${ingredient} レシピ 旬`);
    const items = await fetchRSS(url);
    const fresh = items.filter(item => !isSimilarTitle(item.title, seenTitles)).slice(0, 2);
    return { items: fresh };
  } catch (e) {
    console.warn('[recipe-news]', e.message);
    return { items: [] };
  }
}

// ── 90年代カルチャー選択 ─────────────────────────────────
function selectNinetiesTopic(state) {
  const seenTitles = [...(state.seenNinetiesTitles || []), ...(state.lastNinetiesTitles || [])];
  const freshTopics = NINETIES_TRENDS.filter(topic => !isSimilarTitle(topic.title, seenTitles));
  const pool = freshTopics.length ? freshTopics : NINETIES_TRENDS;
  const daySeed = Number(getJSTDate().replace(/-/g, ''));
  const topic = pool[daySeed % pool.length];
  return {
    ...topic,
    repeated: freshTopics.length === 0,
    note: freshTopics.length ? '過去日記にない90年代カルチャーを一つだけ紹介する。' : '90年代カルチャーは一巡しているので、同じ題材でも別角度で紹介する。',
  };
}

// ── 青空文庫ストーリー管理 ───────────────────────────────
function selectStoryPlan(state) {
  const current = state.story && state.story.phaseIndex < 4 ? state.story : createNewStoryState(state);
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
  return { motifId: next.id, phaseIndex: 0, startedAt: getJSTDate() };
}

function advanceStoryState(state, storyPlan, date) {
  if (storyPlan.isFinal) {
    state.completedStoryMotifs = [...(state.completedStoryMotifs || []), storyPlan.motifId].slice(-10);
    state.story = { motifId: storyPlan.motifId, phaseIndex: 4, startedAt: storyPlan.startedAt, completedAt: date };
    return;
  }
  state.story = { motifId: storyPlan.motifId, phaseIndex: storyPlan.phaseIndex + 1, startedAt: storyPlan.startedAt || date };
}

function getDiaryPhoto() {
  const url = String(DIARY_PHOTO_URL || '').trim();
  if (!url) return null;
  return { url, caption: String(DIARY_PHOTO_CAPTION || '今日のトラペル子').trim() };
}

function updateDiaryStateAfterSuccess(state, date, inputs) {
  const { youtube, worldCup, nineties, storyPlan, recipe } = inputs;
  state.lastRunDate = date;

  if (youtube.signature) {
    state.lastYouTubeSignature = youtube.signature;
    state.lastYouTubeTitles = youtube.videosForDiary.map(v => v.title).slice(0, 8);
  }
  if (youtube.videosForDiary.length) {
    state.seenYouTubeTitles = mergeUniqueTitles(state.seenYouTubeTitles, youtube.videosForDiary.map(v => v.title), 160);
  }
  if (worldCup.active && worldCup.items.length) {
    state.seenWorldCupTitles = [...(state.seenWorldCupTitles || []), ...worldCup.items.map(item => item.title)].slice(-80);
  }
  if (nineties?.title) {
    state.lastNinetiesTitles = [nineties.title];
    state.seenNinetiesTitles = mergeUniqueTitles(state.seenNinetiesTitles, [nineties.title], 120);
  }
  if (recipe?.recipe) {
    state.seenRecipeTitles = mergeUniqueTitles(state.seenRecipeTitles, [recipe.recipe], 60);
  }
  advanceStoryState(state, storyPlan, date);
}

// ── YouTube 動画収集 ──────────────────────────────────────
async function fetchYouTubeVideos() {
  if (!YOUTUBE_API_KEY) { console.warn('[youtube] no API key'); return []; }
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const q = encodeURIComponent('eFootball ウイコレ 最新');
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&type=video&order=date&publishedAfter=${since}&maxResults=8&key=${YOUTUBE_API_KEY}`;
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
      const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]>/s)?.[1] || block.match(/<title>(.*?)<\/title>/s)?.[1] || '').trim();
      const desc = (block.match(/<description><!\[CDATA\[(.*?)\]\]>/s)?.[1] || block.match(/<description>(.*?)<\/description>/s)?.[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
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
  const candidates = ['https://www.konami.com/efootball/ja/news/feed/', 'https://efootball.konami.com/ja/news/feed/'];
  for (const url of candidates) {
    const items = await fetchRSS(url);
    if (items.length) return items;
  }
  return [];
}

async function fetchWorldCupUpdates(date, state) {
  if (!isWithinDateRange(date, WORLD_CUP_2026.startsAt, WORLD_CUP_2026.endsAt)) {
    return { active: false, items: [], note: 'FIFAワールドカップ開催期間外。' };
  }
  const seenTitles = state.seenWorldCupTitles || [];
  const items = await fetchRSS(googleNewsRssUrl(WORLD_CUP_2026.query));
  const freshItems = items.filter(item => !isSimilarTitle(item.title, seenTitles)).slice(0, 3);
  return {
    active: true,
    items: freshItems,
    note: freshItems.length ? 'ゲームではないFIFAワールドカップ開催中。過去日記にない情報だけ使う。' : 'FIFAワールドカップ開催中だが、過去日記にない新しい情報は見つからなかった。',
  };
}

// ── Gemini 日記生成 ──────────────────────────────────────
async function generateDiary(dateLabel, inputs) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const { youtube, news, worldCup, recipe, recipeNews, nineties, storyPlan } = inputs;

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

  const recipeBlock = recipe
    ? [
      `主食材: ${recipe.ingredient}`,
      `料理名: ${recipe.recipe}`,
      `カロリー: 1人前 約${recipe.kcal}kcal（${recipe.servings}人前の場合）`,
      `作り方:`,
      ...recipe.steps.map(s => `　・${s}`),
      `旬メモ: ${recipe.seasonal}`,
      recipeNews.items.length ? `関連トピック: ${recipeNews.items.map(n => n.title).join(' / ')}` : '',
    ].filter(Boolean).join('\n')
    : '（今日の旬の献立は省略）';

  const ninetiesBlock = nineties?.title
    ? [`・${nineties.category}: ${nineties.title}`, `当時の空気: ${nineties.description}`, `25歳から見た視点: ${nineties.perspective}`, `扱い方: ${nineties.note}`].join('\n')
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

▼今日の旬の献立（bob-an・すずめの食卓365日 スタイルで紹介）
${recipeBlock}

▼1990年代に流行っていたもの
${ninetiesBlock}

▼青空文庫からヒントを得た連載ストーリーの今日の材料
題材の由来: ${storyPlan.source}
題材の空気: ${storyPlan.motif}
今日書く場面: ${storyPlan.todayBeat}
今日がこの題材の終わりか: ${storyPlan.isFinal ? 'はい。余韻を残して物語を閉じる。次回から別題材にしてよい。' : 'いいえ。明日へ自然につながる余白を残す。'}

【依頼】
上記の情報をもとに、今日の日記を書いてください。

条件：
- 800〜1200文字の長文
- 人間が書いた日記らしく、4〜8個の自然な段落に分ける。段落と段落の間は必ず空行を入れる。
- 1段落は1〜3文まで。1文ごとに改行する（「。」「！」「？」の後で必ず改行）。短い感情の一文は単独の段落にしてよい。
- 段落の長さを意図的に変える。長めの段落（3文）と短め（1〜2文）を交互に混ぜ、リズムを作る。
- 本物の人間が書いた日記のように、生活感のある描写を交える。ただしコーヒーなど同じ日常描写を毎回くり返さない。
- ニュースや動画を「自分なりに解釈・感想・予測」で膨らませる。単なる要約にしない。
- YouTube検索結果が前回と同じ、または過去日記の動画話題と似ている場合、無理に動画の話を書かない。他の話題（旬の献立・90年代カルチャー・連載ストーリー）を広げる。
- ゲームではないFIFAワールドカップが開催中で、新情報がある場合だけ、以前の日記になかった情報として自然に混ぜる。
- 今日の旬の献立を日記の中に自然に取り入れる。トラペル子が実際に作った設定でも、作ろうと思っている設定でも、誰かに教えたい設定でもよい。必ず「料理名」「主な食材」「カロリー（1人前 約○kcal）」「作り方のポイント（2〜3ステップ）」「旬メモ（栄養・季節感）」を日記の中で自然な文章として伝える。読んだ人が実際に作れるよう、手順を分かりやすく書く。毎回違う切り口（調理の発見、誰かへのおすすめ、季節の気づき）で書く。
- 音楽・曲名・アーティスト・音楽シーンについては一切触れない。
- AI関連ニュースやAI活用術は書かない。収益化系の話題も扱わない。
- 1990年代に流行っていたものを、25歳の私が後から見た世界観で自然に紹介する。懐古しすぎず、「知らない時代だけど空気を想像する」距離感にする。
- 青空文庫由来の連載ストーリーを日記の中に自然に入れる。ただし読者に「青空文庫」「起承転結」「第何話」と説明しない。
- 連載ストーリーは今日の場面だけを書く。題材を途中で変えない。
- ウイコレのゲームとしての魅力や、メンバーの動向への期待感をにじませる。
- 情報がなかった日は「静かな一日」として日常の観察を綴る。
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
    generationConfig: { maxOutputTokens: 2048, temperature: 0.9, thinkingConfig: { thinkingBudget: 0 } },
  };
  const errors = [];
  for (const model of models) {
    for (let attempt = 0; attempt <= GEMINI_RETRY_DELAYS_MS.length; attempt++) {
      try {
        console.log(`[gemini] generate model=${model} attempt=${attempt + 1}`);
        return await requestGeminiGenerateContent(model, requestBody);
      } catch (err) {
        errors.push(`${model}#${attempt + 1}: ${err.message}`);
        if (!err.retryable || attempt >= GEMINI_RETRY_DELAYS_MS.length) { console.warn(`[gemini] giving up model=${model}: ${err.message}`); break; }
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
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
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
  const models = [DIARY_GEMINI_MODEL || DEFAULT_DIARY_GEMINI_MODEL, ...parseCommaList(DIARY_GEMINI_FALLBACK_MODELS), ...DEFAULT_DIARY_GEMINI_FALLBACK_MODELS];
  const seen = new Set();
  return models.map(model => String(model || '').trim()).filter(model => { if (!model || seen.has(model)) return false; seen.add(model); return true; });
}

function parseCommaList(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function isRetryableGeminiError(status, errorPayload) {
  const text = JSON.stringify(errorPayload || '').toLowerCase();
  return [429, 500, 502, 503, 504].includes(Number(status)) || /unavailable|high demand|overloaded|timeout|temporar|rate limit|quota/.test(text);
}

function formatGeminiError(status, errorPayload) {
  const message = errorPayload?.message || JSON.stringify(errorPayload || {});
  const code = status || errorPayload?.code || 'unknown';
  return `HTTP ${code} ${String(message).replace(/\s+/g, ' ').slice(0, 240)}`;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function humanizeDiaryText(text) {
  const cleaned = String(text || '').replace(/\r\n/g, '\n').replace(/^```[a-z]*\n?/i, '').replace(/```$/g, '').replace(/^\s*#{1,6}\s+/gm, '').replace(/^\s*[-*]\s+/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  const paragraphs = cleaned.split(/\n{2,}/).map(p => p.replace(/ {2,}/g, ' ').trim()).filter(Boolean);
  const breathingParagraphs = paragraphs.flatMap(p => splitParagraphForBreathing(p));
  if (breathingParagraphs.length >= 3) return breathingParagraphs.join('\n\n');
  const sentences = cleaned.replace(/\n+/g, ' ').replace(/\s+/g, ' ').split(/(?<=[。！？])/).map(s => s.trim()).filter(Boolean);
  if (sentences.length <= 2) return cleaned;
  const rebuilt = [];
  let current = [];
  let currentLength = 0;
  for (const sentence of sentences) {
    current.push(sentence);
    currentLength += sentence.length;
    if (currentLength >= 130 || current.length >= 3) { rebuilt.push(current.join('\n')); current = []; currentLength = 0; }
  }
  if (current.length) rebuilt.push(current.join('\n'));
  return rebuilt.flatMap(p => splitParagraphForBreathing(p)).join('\n\n');
}

function splitParagraphForBreathing(paragraph) {
  const text = String(paragraph || '').trim();
  if (text.includes('\n')) {
    if (text.length <= 300) return [text];
    const lines = text.split('\n').filter(Boolean);
    const chunks = [];
    let chunk = [];
    let len = 0;
    for (const line of lines) {
      chunk.push(line);
      len += line.length;
      if (len >= 200 && chunk.length >= 2) { chunks.push(chunk.join('\n')); chunk = []; len = 0; }
    }
    if (chunk.length) chunks.push(chunk.join('\n'));
    return chunks.filter(Boolean);
  }
  if (text.length <= 180) return [text].filter(Boolean);
  const sentences = text.split(/(?<=[。！？])/).map(s => s.trim()).filter(Boolean);
  if (sentences.length <= 2) return [text];
  const chunks = [];
  let current = [];
  let length = 0;
  for (const sentence of sentences) {
    current.push(sentence);
    length += sentence.length;
    if (length >= 160 || current.length >= 3) { chunks.push(current.join('\n')); current = []; length = 0; }
  }
  if (current.length) chunks.push(current.join('\n'));
  return chunks.filter(Boolean);
}

function attachDiaryPhoto(diaryText, photo) {
  if (!photo?.url) return diaryText;
  const caption = photo.caption || '今日のトラペル子';
  return [`![${caption}](${photo.url})`, '', caption, '', diaryText].join('\n');
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function diaryTextToHtml(text) {
  return String(text || '').split(/\n{2,}/).map(p => {
    const lines = p.trim().split('\n').map(l => escapeHtml(l.trim())).filter(Boolean);
    if (!lines.length) return '';
    return `<p>${lines.join('<br>')}</p>`;
  }).filter(Boolean).join('\n');
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
  <category term="レシピ" />
  <app:control><app:draft>no</app:draft></app:control>
</entry>`;
  const credentials = Buffer.from(`${HATENA_ID}:${HATENA_API_KEY}`).toString('base64');
  const url = `https://blog.hatena.ne.jp/${HATENA_ID}/${HATENA_BLOG_ID}/atom/entry`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8', 'Authorization': `Basic ${credentials}` },
    body: atom,
  });
  if (!res.ok) { const body = await res.text(); throw new Error(`Hatena Blog API error ${res.status}: ${body.slice(0, 200)}`); }
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
  const { videos, news, worldCup, recipe } = sources;
  const summaryItems = [
    ...news.slice(0, 3).map(n => n.title),
    ...videos.slice(0, 2).map(v => v.title),
    ...(worldCup?.items || []).slice(0, 1).map(v => v.title),
    ...(recipe?.recipe ? [recipe.recipe] : []),
  ];
  await db.ref('config/uicolleNews').set({
    event:     summaryItems.slice(0, 3).join('\n') || '今日の情報は少なめだったみたい',
    gacha:     '',
    updatedAt: date,
    diary:     diaryText.slice(0, 600),
    blogUrl:   postUrl || '',
    photoUrl:  photo?.url || '',
  });
  await db.ref(`diary/${date}`).set({
    text:      diaryText,
    blogUrl:   postUrl || '',
    photoUrl:  photo?.url || '',
    sources: {
      news:     news.map(n => n.title),
      videos:   videos.map(v => v.title),
      worldCup: (worldCup?.items || []).map(n => n.title),
      recipe:   recipe?.recipe || '',
      nineties: sources.nineties?.title ? [sources.nineties.title] : [],
    },
    createdAt: Date.now(),
  });
  console.log('[firebase] archived');
}

// ── ローカル blog/ に保存 ────────────────────────────────
function saveBlogMarkdown(date, dateLabel, diaryText, postUrl) {
  ensureBlogDir();
  const md = [`# ${dateLabel}の日記`, '', postUrl ? `[はてなブログで読む](${postUrl})` : '', '', diaryText, ''].filter(l => l !== undefined).join('\n');
  fs.writeFileSync(path.join(BLOG_DIR, `${date}.md`), md, 'utf8');
  const files = fs.readdirSync(BLOG_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse().slice(0, 30);
  const index = ['# 秘書トラペル子の日記', '', '毎日のウイコレ情報と、私の思ったことをここに残してるよ。', '', ...files.map(f => { const d = f.replace('.md', ''); const [y, m, day] = d.split('-'); return `- [${y}年${m}月${day}日](./${f})`; })].join('\n');
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

  const [worldCup, recipeNews] = await Promise.all([
    fetchWorldCupUpdates(date, state).catch(e => {
      console.error('[worldcup]', e.message);
      return { active: false, items: [], note: '取得に失敗したので触れない。' };
    }),
    (async () => {
      const recipe = selectDailyRecipe(date, state);
      return fetchRecipeContextNews(recipe?.ingredient || '', state).catch(() => ({ items: [] }));
    })(),
  ]);

  const recipe = selectDailyRecipe(date, state);
  const nineties = selectNinetiesTopic(state);
  const storyPlan = selectStoryPlan(state);

  console.log(`[diary] worldCup=${worldCup.items.length} recipe=${recipe?.recipe} nineties=${nineties?.title || 'none'}`);
  console.log(`[story] ${storyPlan.motifId} phase=${storyPlan.phaseIndex + 1}${storyPlan.isFinal ? ' final' : ''}`);

  const inputs = { youtube, news, worldCup, recipe, recipeNews, nineties, storyPlan };
  const photo = getDiaryPhoto();
  if (photo) console.log(`[photo] using ${photo.url}`);

  const diaryBody = await generateDiary(dateLabel, inputs);
  const diaryText = attachDiaryPhoto(diaryBody, photo);
  console.log(`[diary] generated ${diaryText.length}chars`);

  const postUrl = await postToHatenaBlog(date, dateLabel, diaryText)
    .catch(e => { console.error('[hatena]', e.message); return null; });

  saveBlogMarkdown(date, dateLabel, diaryText, postUrl);

  if (FIREBASE_SERVICE_ACCOUNT && FIREBASE_DATABASE_URL) {
    await saveToFirebase(date, diaryText, postUrl, { videos: youtube.videosForDiary, news, worldCup, recipe, nineties }, photo)
      .catch(e => console.error('[firebase]', e.message));
  }

  updateDiaryStateAfterSuccess(state, date, inputs);
  saveDiaryState(state);

  console.log('[diary] done');
  process.exit(0);
}

main().catch(e => { console.error('[diary] fatal', e); process.exit(1); });
