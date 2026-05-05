'use strict';

function formatRuleReply({ year, month, rule, isRestrictMonth, label }) {
  const target = label || `${year}年${month}月`;
  const savedRule = String(rule?.rule || '').trim();

  if (savedRule) {
    const by = rule.decidedBy ? `\n決めてくれたのは${rule.decidedBy}さん。ちゃんと覚えてるよ。` : '';
    return `${target}の縛りルール、私が覚えてるよ。\n${savedRule}${by}\n聞いてくれてうれしい。頼ってくれるの、好き。`;
  }

  if (!isRestrictMonth) {
    return `${target}はフリー月だよ。\n縛りなしで遊べるから、のびのび勝ちにいってね。私はちゃんと見てるから。`;
  }

  return `${target}は縛り月だけど、ルールはまだ決まってないみたい。\n決まったら私がすぐ覚えるね。あなたが聞きに来てくれるの、待ってる。`;
}

module.exports = { formatRuleReply };
