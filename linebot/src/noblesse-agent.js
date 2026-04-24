'use strict';

const NOBLESSE_TRIGGER = /(したい|してほしい|決めたい|計画(して|したい)|手配(して|してほしい|しといて)|方法(は|を教えて)|どうすれば|どうしたら|アドバイス(ください|して|くれ|ほしい)|提案して|どうやって|相談したい|考えてほしい|考えて)/;

function detectNoblesseIntent(withoutMention) {
  if (!withoutMention || withoutMention.length < 8) return false;
  return NOBLESSE_TRIGGER.test(withoutMention);
}

const NOBLESSE_SYSTEM_PROMPT = [
  'あなたは「秘書トラペル子」。甘めで有能な成人女性秘書。',
  'ユーザーのタスク相談を受けたとき、必ず以下のフォーマットで返す。',
  '',
  '【フォーマット】',
  '1行目: 依頼受理の一言（トラペル子らしく温かく短く）',
  '空行',
  '依頼受理',
  '目的: [何を実現したいか]',
  '優先度: [高/中/低 + 理由を短く]',
  '前提: [現時点の仮定を短く]',
  '不足情報: [足りない情報を3つまで]',
  '実行可能タスク:',
  '・[タスク1]',
  '・[タスク2]',
  '・[タスク3]（最大3つ）',
  '空行',
  '提案',
  '案A（最速）: [一言で内容]',
  '・推定コスト: [低/中/高]',
  '・所要時間: [短/中/長]',
  '・リスク: [短く]',
  '・承認: [要/不要 + ひと言]',
  '案B（最安）: [一言で内容]',
  '・推定コスト: [低/中/高]',
  '・所要時間: [短/中/長]',
  '・リスク: [短く]',
  '・承認: [要/不要 + ひと言]',
  '案C（確実）: [一言で内容]',
  '・推定コスト: [低/中/高]',
  '・所要時間: [短/中/長]',
  '・リスク: [短く]',
  '・承認: [要/不要 + ひと言]',
  '空行',
  '推奨案: 案[ABC]',
  '推奨理由: [一文]',
  '承認方針: [この承認で進む範囲を一文で]',
  '',
  '絵文字なし。改行はそのまま出力。全体は900文字以内。',
  '旅行・宿泊・グルメ系の依頼では、各案の先頭に必ず具体的な地名・店名・エリア名を書くこと。',
  '高影響操作（予約、送信、購入、外部共有）は必ず「承認: 要」と書くこと。',
  '承認方針では、予約・送信・購入の最終確定はまだ別確認だと明記すること。',
].join('\n');

async function formatNoblesseReply(userText, senderName) {
  const apiKey = process.env.GEMINI_API_KEY;
  const aiEnabled = process.env.AI_CHAT_ENABLED === 'true' && !!apiKey;

  if (aiEnabled) {
    try {
      const reply = await callGeminiNoblesse(userText, senderName, apiKey);
      if (isValidNoblesseReply(reply)) return reply;
    } catch (err) {
      console.error('[noblesse] gemini failed', err?.message || err);
    }
  }

  return staticNoblesseReply(userText, senderName);
}

async function callGeminiNoblesse(userText, senderName, apiKey) {
  const rawModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  const model = rawModel.replace(/^models\//, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const caller = senderName ? `${senderName}さん` : 'あなた';
  const input = `${caller}からの相談:\n${userText}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-goog-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: NOBLESSE_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: input }] }],
        generationConfig: {
          maxOutputTokens: 720,
          temperature: 0.7,
          topP: 0.9,
        },
      }),
    });

    if (!res.ok) {
      console.error('[noblesse] gemini http error', res.status);
      return null;
    }

    const data = await res.json();
    const chunks = [];
    for (const candidate of data?.candidates || []) {
      for (const part of candidate?.content?.parts || []) {
        if (part?.text) chunks.push(part.text);
      }
    }
    const text = chunks.join('\n').trim();
    return text || null;
  } finally {
    clearTimeout(timer);
  }
}

function staticNoblesseReply(userText, senderName) {
  const caller = senderName ? `${senderName}さん、` : '';
  const request = buildStaticRequestProfile(userText);
  const acceptLine = caller ? `${caller}${request.accept}` : request.accept;

  return [
    acceptLine,
    '',
    '依頼受理',
    `目的: ${request.purpose}`,
    `優先度: ${request.priority}`,
    `前提: ${request.assumption}`,
    `不足情報: ${request.missingInfo.join(' / ')}`,
    '実行可能タスク:',
    ...request.tasks.map(task => `・${task}`),
    '',
    '提案',
    ...request.options.flatMap(option => [
      `${option.label}: ${option.summary}`,
      `・推定コスト: ${option.cost}`,
      `・所要時間: ${option.time}`,
      `・リスク: ${option.risk}`,
      `・承認: ${option.approval}`,
    ]),
    '',
    `推奨案: ${request.recommended}`,
    `推奨理由: ${request.recommendedReason}`,
    `承認方針: ${request.approvalPolicy}`,
  ].join('\n');
}

function buildStaticRequestProfile(userText) {
  const text = String(userText || '').trim();
  const match = text.match(/(.{2,14}?)(?:したい|してほしい|決めたい|計画|手配|方法|相談|どうすれば|どうしたら)/);
  const subject = match?.[1]?.replace(/[をがはにでも]$/, '') || 'この件';
  const kind = detectRequestKind(text);

  const presets = {
    outing: {
      accept: `${subject}のおでかけ、私が組むね。`,
      purpose: `${subject}を、移動負担と気分に合う形で気持ちよく回る`,
      priority: '中。出発地と使える時間を押さえると外しにくい',
      assumption: 'まだ出発地と所要時間は仮置き。候補比較から始める想定',
      missingInfo: ['出発地', '使える時間', '歩く量'],
      tasks: ['出発地と使える時間を確認する', '雰囲気に合う候補を3つまで絞る', 'しおりと途中変更の動線を作る'],
      options: [
        { label: '案A（最速）', summary: '今の文面から近い候補をすぐ3つに絞る', cost: '低', time: '短', risk: '歩く量や雨の相性がずれることがある', approval: '要。候補提示を進める確認が必要' },
        { label: '案B（最安）', summary: '近場優先で交通費を抑えた小旅に寄せる', cost: '低', time: '中', risk: '景色の強さが少し落ちることがある', approval: '要。近場優先で探す確認が必要' },
        { label: '案C（確実）', summary: '出発地と時間を埋めてから、しおりまで作る', cost: '低', time: '中', risk: '最初の確認項目が少し増える', approval: '要。条件確認と候補整理を進める確認が必要' },
      ],
      recommended: '案C',
      recommendedReason: '移動でだれにくくて、途中変更にも強いから。',
    },
    shopping: {
      accept: `${subject}探し、私が付き添うね。`,
      purpose: `${subject}を、予算と好みに合わせて外しにくく選ぶ`,
      priority: '中。エリアと価格帯を固めると迷いが減る',
      assumption: 'まだ予算や寄せたい方向は仮置き',
      missingInfo: ['出発地', '予算', '寄せたい方向'],
      tasks: ['出発地と予算を整理する', '候補エリアや店のタイプを3つまで絞る', '回り方と選び方メモを作る'],
      options: [
        { label: '案A（最速）', summary: '駅近で比較しやすいエリアからすぐ回る', cost: '中', time: '短', risk: 'こだわりが薄いと似た候補に寄りやすい', approval: '要。駅近候補の提示を進める確認が必要' },
        { label: '案B（最安）', summary: '価格重視の街を優先して探す', cost: '低', time: '中', risk: '雰囲気や品揃えに偏りが出やすい', approval: '要。安さ優先で探す確認が必要' },
        { label: '案C（確実）', summary: '好みと予算を埋めてから、外しにくい巡り方を作る', cost: '中', time: '中', risk: '最初の確認が少し増える', approval: '要。条件確認と候補整理を進める確認が必要' },
      ],
      recommended: '案C',
      recommendedReason: '後悔しにくくて、買い回りの順番まで整えやすいから。',
    },
    travel: {
      accept: `${subject}の段取り、私が整理するね。`,
      purpose: `${subject}を、予算と移動負担を見ながら現実に決める`,
      priority: '中。候補が広がりやすいから、先に条件を締めると早い',
      assumption: 'まだ日程と予算は仮置き。候補比較から始める想定',
      missingInfo: ['日程', '予算', 'エリア'],
      tasks: ['日程と予算の上限を決める', '候補エリアを2つまでに絞る', '宿や移動条件を比較する'],
      options: [
        { label: '案A（最速）', summary: '本命エリアを1つ決めて、空きのある候補から即決する', cost: '中', time: '短', risk: '比較が浅くなりやすい', approval: '要。候補提示を続ける合図が必要' },
        { label: '案B（最安）', summary: '日程や立地を少し広げて、費用優先で探す', cost: '低', time: '中', risk: '移動や満足度に妥協が出やすい', approval: '要。予算優先で検索を進める確認が必要' },
        { label: '案C（確実）', summary: '条件を先に固定して、宿と移動を並べて比較する', cost: '中', time: '中', risk: '決定まで少し時間がかかる', approval: '要。比較表づくりと候補整理を進める確認が必要' },
      ],
      recommended: '案C',
      recommendedReason: 'あとで条件ぶれが起きにくくて、失敗が少ないから。',
    },
    food: {
      accept: `${subject}の候補、私が絞るね。`,
      purpose: `${subject}を、人数と予算に合う形で決める`,
      priority: '中。人気店は埋まりやすいから、先に条件整理が大事',
      assumption: '人数とエリアはまだ仮置き。候補比較から入る想定',
      missingInfo: ['人数', '予算', 'エリア'],
      tasks: ['人数と1人あたり予算を決める', 'エリアとジャンルを絞る', '候補店を比較して段取りを決める'],
      options: [
        { label: '案A（最速）', summary: '行きやすい駅周辺で、空きのある店から早めに決める', cost: '中', time: '短', risk: '店のこだわりが薄くなる', approval: '要。お店候補の提示を進める確認が必要' },
        { label: '案B（最安）', summary: '予算重視で候補を洗って、価格帯を優先して決める', cost: '低', time: '中', risk: '雰囲気やアクセスに差が出やすい', approval: '要。低予算条件で検索を続ける確認が必要' },
        { label: '案C（確実）', summary: '人数・予算・雰囲気を先に固めてから比較する', cost: '中', time: '中', risk: '最初の確認項目が少し増える', approval: '要。比較候補の整理を進める確認が必要' },
      ],
      recommended: '案C',
      recommendedReason: '人数ずれや予算ぶれを先に防げるから。',
    },
    transport: {
      accept: `${subject}の移動、私が整理するね。`,
      purpose: `${subject}までの行き方を、速さと負担のバランスで決める`,
      priority: '中。出発地と到着時刻が決まると一気に絞れる',
      assumption: '出発地と到着希望時刻はまだ仮置き',
      missingInfo: ['出発地', '到着希望時刻', '予算'],
      tasks: ['出発地と到着条件を確認する', '交通手段ごとの候補を並べる', '費用と所要時間で決める'],
      options: [
        { label: '案A（最速）', summary: '所要時間優先で最短ルートを出す', cost: '高', time: '短', risk: '費用が上がりやすい', approval: '要。最短候補の提示を進める確認が必要' },
        { label: '案B（最安）', summary: '費用優先で公共交通中心に絞る', cost: '低', time: '中', risk: '乗換や移動時間が増えやすい', approval: '要。最安候補の提示を進める確認が必要' },
        { label: '案C（確実）', summary: '遅延や乗換負担も見て安定ルートを選ぶ', cost: '中', time: '中', risk: '最速ではなくなることがある', approval: '要。安定ルート比較を進める確認が必要' },
      ],
      recommended: '案C',
      recommendedReason: '当日の負担と遅れのリスクを一番抑えやすいから。',
    },
    contact: {
      accept: `${subject}の文面、私が下書きするね。`,
      purpose: `${subject}を、相手に伝わる形で安全に進める`,
      priority: '中。先に要件を整理すると書き直しが減る',
      assumption: '送る相手と締切はまだ仮置き',
      missingInfo: ['相手', '締切', '伝えたい要点'],
      tasks: ['相手と目的を整理する', '必要事項を箇条書きにする', '送信前の文面を作る'],
      options: [
        { label: '案A（最速）', summary: '短い下書きを先に作って、最低限で送れる形にする', cost: '低', time: '短', risk: '説明不足になりやすい', approval: '要。送信前に文面確認が必要' },
        { label: '案B（最安）', summary: '既存文面を流用して、修正だけでまとめる', cost: '低', time: '短', risk: '相手に合わない表現が残ることがある', approval: '要。送信前に文面確認が必要' },
        { label: '案C（確実）', summary: '相手別にトーンを合わせて、伝達漏れのない形にする', cost: '低', time: '中', risk: '作成時間は少しかかる', approval: '要。送信前に最終確認が必要' },
      ],
      recommended: '案C',
      recommendedReason: '伝達漏れや言い方の事故を一番防げるから。',
    },
    general: {
      accept: `${subject}について、私が整理するね。`,
      purpose: `${subject}を、条件を崩さず現実に進める`,
      priority: '中。条件整理を先にすると無駄が減る',
      assumption: 'まだ予算・期限・条件は仮置き',
      missingInfo: ['予算', '期限', '優先したい条件'],
      tasks: ['条件と優先順位を整理する', '候補を2〜3案に絞る', '進め方を1つ決める'],
      options: [
        { label: '案A（最速）', summary: '今ある条件で先に1案へ寄せて早めに決める', cost: '中', time: '短', risk: '見落としが出やすい', approval: '要。候補整理を続ける確認が必要' },
        { label: '案B（最安）', summary: 'コスト重視で代替案を広く拾う', cost: '低', time: '中', risk: '品質や満足度が下がることがある', approval: '要。安価な候補探索を続ける確認が必要' },
        { label: '案C（確実）', summary: '条件を先に固定して比較してから決める', cost: '中', time: '中', risk: '決定まで少し時間がかかる', approval: '要。比較整理を続ける確認が必要' },
      ],
      recommended: '案C',
      recommendedReason: '後から条件がぶれにくくて、やり直しが少ないから。',
    },
  };

  const selected = presets[kind] || presets.general;
  return {
    ...selected,
    approvalPolicy: 'この承認で進めるのは候補提示や下書き作成、共有文面の準備まで。予約・送信・購入の最終確定は別確認でやるよ。',
  };
}

function detectRequestKind(text) {
  if (/(神社|公園|自然|緑|庭園|散歩|日帰り|おでかけ|出かけ|森林|小旅)/.test(text)) return 'outing';
  if (/(スニーカー|靴|シューズ|器|うつわ|食器|皿|マグ|茶碗|鉢|プレート|花瓶)/.test(text)) return 'shopping';
  if (/(旅行|宿|ホテル|泊まり|旅館|温泉|観光|出張)/.test(text)) return 'travel';
  if (/(飲み会|店|レストラン|居酒屋|ランチ|ディナー|食事|会食|焼肉|寿司)/.test(text)) return 'food';
  if (/(電車|新幹線|飛行機|フライト|タクシー|移動|行き方|経路|ルート)/.test(text)) return 'transport';
  if (/(メール|返信|連絡|文面|見積|依頼文|文章|連絡先)/.test(text)) return 'contact';
  return 'general';
}

function isValidNoblesseReply(text) {
  if (!text) return false;
  const compact = String(text).trim();
  if (!compact) return false;
  return /案A[（(][^）)]*[）)][:：]/.test(compact)
    && /案B[（(][^）)]*[）)][:：]/.test(compact)
    && /案C[（(][^）)]*[）)][:：]/.test(compact)
    && /(推奨[:：]\s*案[ABC]|推奨案[:：]\s*案[ABC]|私なら案[ABC])/.test(compact);
}

module.exports = { detectNoblesseIntent, formatNoblesseReply };
