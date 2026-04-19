'use strict';
/* Node.js移植版 ocr.js
   - document.createElement('canvas') → canvas npm パッケージ
   - new Image() / URL.createObjectURL → loadImage(buffer)
   - Tesseract グローバル → require('tesseract.js')
   ロジック・定数はブラウザ版 ocr.js (v49) と完全同一
*/

const { createCanvas, loadImage } = require('canvas');
const Tesseract = require('tesseract.js');

const CACHE_PATH = '/tmp/tesseract-cache';
let _worker = null;

async function ensureWorker() {
  if (_worker) return _worker;
  _worker = await Tesseract.createWorker('jpn+eng', 1, {
    cachePath: CACHE_PATH,
    logger: m => {
      if (m.status === 'recognizing text') {
        process.stdout.write(`\r[OCR] ${Math.round(m.progress * 100)}%`);
      }
    },
  });
  return _worker;
}

/* ── cropImage: imgEl は canvas の Image オブジェクト ── */
function cropImage(imgEl, relX, relY, relW, relH, scale = 2) {
  const W = imgEl.width;
  const H = imgEl.height;
  const srcX = Math.round(W * relX);
  const srcY = Math.round(H * relY);
  const srcW = Math.round(W * relW);
  const srcH = Math.round(H * relH);
  const canvas = createCanvas(srcW * scale, srcH * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(imgEl, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function firstDigit(text) {
  const m = String(text || '').match(/\d/);
  return m ? parseInt(m[0], 10) : null;
}

function pickVotedDigitInfo(values) {
  const counts = new Map();
  for (const value of values) {
    if (value === null || value === undefined) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  let best = null, bestCount = 0, secondCount = 0;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) { secondCount = bestCount; best = value; bestCount = count; }
    else if (count > secondCount) { secondCount = count; }
  }
  const margin = bestCount - secondCount;
  return {
    digit: bestCount >= 3 && margin >= 2 ? best : null,
    best, count: bestCount, margin,
    total: values.filter(v => v !== null && v !== undefined).length,
  };
}

function sameScore(a, b) { return !!a && !!b && a[0] === b[0] && a[1] === b[1]; }

function preprocessInvert(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = lum > 150 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

function preprocessBgDiff(canvas, blurRadius, diffThreshold) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const imageData = ctx.getImageData(0, 0, W, H);
  const d = imageData.data;
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const pi = i * 4;
    gray[i] = 0.299 * d[pi] + 0.587 * d[pi + 1] + 0.114 * d[pi + 2];
  }
  const W1 = W + 1;
  const sat = new Float64Array(W1 * (H + 1));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      sat[(y+1)*W1+(x+1)] = gray[y*W+x] + sat[y*W1+(x+1)] + sat[(y+1)*W1+x] - sat[y*W1+x];
    }
  }
  const r = blurRadius;
  const blurred = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const x1=Math.max(0,x-r),y1=Math.max(0,y-r),x2=Math.min(W-1,x+r),y2=Math.min(H-1,y+r);
      const cnt = (x2-x1+1)*(y2-y1+1);
      blurred[y*W+x] = (sat[(y2+1)*W1+(x2+1)] - sat[y1*W1+(x2+1)] - sat[(y2+1)*W1+x1] + sat[y1*W1+x1]) / cnt;
    }
  }
  const binary = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) binary[i] = (gray[i] - blurred[i]) > diffThreshold ? 0 : 255;
  const kr = 2;
  const tmp = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 255;
      for (let dy=-kr;dy<=kr;dy++) for (let dx=-kr;dx<=kr;dx++) {
        const ny=y+dy,nx=x+dx;
        if (ny>=0&&ny<H&&nx>=0&&nx<W&&binary[ny*W+nx]<v) v=binary[ny*W+nx];
      }
      tmp[y*W+x] = v;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let dy=-kr;dy<=kr;dy++) for (let dx=-kr;dx<=kr;dx++) {
        const ny=y+dy,nx=x+dx;
        if (ny>=0&&ny<H&&nx>=0&&nx<W&&tmp[ny*W+nx]>v) v=tmp[ny*W+nx];
      }
      const pi = (y*W+x)*4;
      d[pi]=d[pi+1]=d[pi+2]=v; d[pi+3]=255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function detectLeftBadgeHome(canvas) {
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let green = 0, red = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r=data[i],g=data[i+1],b=data[i+2];
    const max=Math.max(r,g,b),min=Math.min(r,g,b);
    if (max-min<50||max<80) continue;
    if (g>r*1.2&&g>b*1.5) green++;
    else if (r>g*1.3&&r>b) red++;
  }
  return { leftIsHome: green > red, badgeDebug: `g=${green} r=${red}` };
}

function normalizeText(str) {
  if (!str) return '';
  return str.normalize('NFKC')
    .replace(/[ァィゥェォ]/g, c => String.fromCharCode(c.charCodeAt(0)+1))
    .replace(/[ッャュョ]/g, c => String.fromCharCode(c.charCodeAt(0)+1))
    .replace(/[？?]/g,'')
    .replace(/[・．。、\-_]/g,'')
    .replace(/\s+/g,'')
    .toLowerCase();
}

function levenshtein(a, b) {
  const m=a.length,n=b.length;
  if(m===0)return n; if(n===0)return m;
  const dp=[];
  for(let i=0;i<=m;i++){dp[i]=[i];for(let j=1;j<=n;j++) dp[i][j]=i===0?j:a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);}
  return dp[m][n];
}

function partialRatio(shorter, longer) {
  if(shorter.length>longer.length)return partialRatio(longer,shorter);
  if(shorter.length===0)return 0;
  let best=0;
  for(let i=0;i<=longer.length-shorter.length;i++){
    const w=longer.slice(i,i+shorter.length);
    const sim=1-levenshtein(shorter,w)/shorter.length;
    if(sim>best)best=sim;
  }
  return best;
}

function ngrams(str,n){const s=new Set();for(let i=0;i<=str.length-n;i++)s.add(str.slice(i,i+n));return s;}

function extractScore(text) {
  for (let line of text.split('\n')) {
    line = line.replace(/\bb([-－—–−―・])/g,'6$1').replace(/([-－—–−―・])b\b/g,'$16')
               .replace(/\bB([-－—–−―・])/g,'8$1').replace(/([-－—–−―・])B\b/g,'$18');
    const m = line.match(/(\d{1,2})\s*[-－—–−―・]\s*(\d{1,2})/)
           || line.match(/\b(\d)\s{1,4}(\d)\b/);
    if(!m)continue;
    let a=parseInt(m[1],10),b=parseInt(m[2],10);
    if(a>15&&a<=99)a=Math.floor(a/10);
    if(b>15&&b<=99)b=Math.floor(b/10);
    if(a<=15&&b<=15)return[a,b];
  }
  return null;
}

function matchTeamName(ocrText, playerMap) {
  if(!ocrText||!playerMap)return null;
  const normalized=normalizeText(ocrText);
  if(normalized.length<2)return null;
  const karaEntry=Object.entries(playerMap).find(([charName])=>normalizeText(charName)===normalizeText('カラキソングシティ'));
  const THRESHOLD=0.45;
  let best=null,bestScore=0;
  for(const[charName,playerName]of Object.entries(playerMap)){
    const charNorm=normalizeText(charName);
    if(!charNorm)continue;
    const minLen=Math.min(normalized.length,charNorm.length);
    const maxLen=Math.max(normalized.length,charNorm.length);
    let score=0;
    if(minLen>=2&&(normalized.includes(charNorm)||charNorm.includes(normalized)))score=0.95;
    if(score<0.70&&minLen>=2){const pr=partialRatio(charNorm,normalized);if(pr*0.90>score)score=pr*0.90;}
    if(score<0.70&&minLen>=2){const dist=levenshtein(normalized,charNorm);const maxA=Math.max(1,Math.floor(maxLen*0.35));if(dist<=maxA){const sim=1-dist/maxLen;if(sim>score)score=sim;}}
    if(score<THRESHOLD&&minLen>=3){const ngA=ngrams(normalized,2),ngB=ngrams(charNorm,2);if(ngA.size>0&&ngB.size>0){let inter=0;for(const g of ngA)if(ngB.has(g))inter++;const union=ngA.size+ngB.size-inter;score=union>0?inter/union:0;}}
    if(score>bestScore&&score>=THRESHOLD){bestScore=score;best={charName,playerName,score:Math.round(score*100)/100};}
  }
  if(!best&&karaEntry){
    const[charName,playerName]=karaEntry;
    if(normalized.includes('カラキ')||normalized.includes('キゾラツク')||normalized.includes('カみキ')||normalized.includes('カミキ')||normalized==='0sl'||normalized==='osl')
      best={charName,playerName,score:0.46};
  }
  return best;
}

async function readDigitSide(worker, imgEl, boxes, sideLabel) {
  const values=[],raw=[];
  const readWithPsm=async psm=>{
    for(const box of boxes){
      for(const prep of['BgD','Inv']){
        await worker.setParameters({tessedit_pageseg_mode:psm,tessedit_char_whitelist:'0123456789'});
        const canvas=cropImage(imgEl,box[0],box[1],box[2],box[3],4);
        if(prep==='BgD')preprocessBgDiff(canvas,40,40); else preprocessInvert(canvas);
        const result=await worker.recognize(canvas.toBuffer('image/png'));
        const digit=firstDigit(result.data.text.trim());
        values.push(digit); raw.push(`${sideLabel}${prep}${psm}:${result.data.text.trim()||'-'}`);
      }
    }
  };
  await readWithPsm('10');
  let info=pickVotedDigitInfo(values);
  if(info.digit===null){await readWithPsm('13');info=pickVotedDigitInfo(values);}
  return{digit:info.digit,confidence:info.count,raw:`${sideLabel}=${info.best??'-'}(${info.count}/${info.total},m${info.margin}) ${raw.join(' ')}`};
}

async function readScoreDigitsFallback(worker, imgEl) {
  const leftBoxes=[[0.365,0.235,0.105,0.095],[0.375,0.235,0.090,0.095],[0.355,0.225,0.120,0.110],[0.350,0.230,0.130,0.105],[0.340,0.225,0.140,0.110],[0.360,0.220,0.110,0.130]];
  const rightBoxes=[[0.535,0.235,0.090,0.095],[0.525,0.235,0.105,0.095],[0.515,0.225,0.120,0.110],[0.510,0.230,0.130,0.105],[0.505,0.225,0.140,0.110],[0.520,0.220,0.110,0.130]];
  const left=await readDigitSide(worker,imgEl,leftBoxes,'L');
  const right=await readDigitSide(worker,imgEl,rightBoxes,'R');
  await worker.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:''});
  if(left.digit===null||right.digit===null)return{score:null,raw:`${left.raw} ${right.raw}`};
  return{score:[left.digit,right.digit],confidence:Math.min(left.confidence,right.confidence),raw:`${left.raw} ${right.raw}`};
}

async function retryTeamName(worker, imgEl, relX, relY, relW, relH, playerMap) {
  await worker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
  const canvas=cropImage(imgEl,relX,relY,relW,relH,3);
  const result=await worker.recognize(canvas.toBuffer('image/png'));
  const raw=result.data.text.trim().replace(/\n/g,' ');
  return{raw,match:matchTeamName(raw,playerMap)};
}

/* ── メイン: Buffer → OCR結果オブジェクト ── */
async function parseMatchResult(imageBuffer, playerMap) {
  const imgEl  = await loadImage(imageBuffer);
  const worker = await ensureWorker();

  await worker.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:''});
  const scoreCanvasBg=cropImage(imgEl,0.30,0.23,0.40,0.11,3); preprocessBgDiff(scoreCanvasBg,40,40);
  const scoreBg=extractScore((await worker.recognize(scoreCanvasBg.toBuffer('image/png'))).data.text);
  const scoreCanvasInv=cropImage(imgEl,0.30,0.23,0.40,0.11,3); preprocessInvert(scoreCanvasInv);
  const scoreResultInv=await worker.recognize(scoreCanvasInv.toBuffer('image/png'));
  const scoreInv=extractScore(scoreResultInv.data.text);

  let scoreArr=null,scoreMethod='Fail';
  const shouldCheckDigits=(!scoreBg&&!scoreInv)||(scoreBg&&scoreInv&&!sameScore(scoreBg,scoreInv))||(scoreBg&&scoreBg[0]===scoreBg[1])||(scoreInv&&scoreInv[0]===scoreInv[1]);
  if(shouldCheckDigits){
    const df=await readScoreDigitsFallback(worker,imgEl);
    if(df.score){scoreArr=df.score;scoreMethod='DigitFallback';}
    else if(scoreBg){scoreArr=scoreBg;scoreMethod='BgDiff';}
    else if(scoreInv){scoreArr=scoreInv;scoreMethod='Invert';}
  }else if(scoreBg){scoreArr=scoreBg;scoreMethod='BgDiff';}
  else if(scoreInv){scoreArr=scoreInv;scoreMethod='Invert';}

  const leftScore=scoreArr?scoreArr[0]:null;
  const rightScore=scoreArr?scoreArr[1]:null;

  /* PK */
  const _findPK=text=>{
    let m=text.match(/(\d)\s*PK\s*(\d)/i);
    if(m)return[parseInt(m[1],10),parseInt(m[2],10)];
    const stripped=text.replace(/[_「」\[\]|,.'`~]/g,' ');
    m=stripped.match(/(\d)\s*PK\s*(\d)/i);
    if(m)return[parseInt(m[1],10),parseInt(m[2],10)];
    const OCR_DIG={g:2,G:2,z:2,Z:2,l:1,I:1,s:5,S:5,O:0,o:0,q:9,b:6,B:8};
    for(const line of stripped.split('\n')){
      const pkIdx=line.toLowerCase().indexOf('pk'); if(pkIdx<0)continue;
      const beforePK=line.substring(0,pkIdx).trimEnd();
      const afterPK=line.substring(pkIdx+2);
      const rightMatch=afterPK.match(/^\s*(\d)/); if(!rightMatch)continue;
      const rightVal=parseInt(rightMatch[1],10);
      const lastCh=beforePK.slice(-1);
      if(/\d/.test(lastCh))return[parseInt(lastCh,10),rightVal];
      if(OCR_DIG[lastCh]!==undefined)return[OCR_DIG[lastCh],rightVal];
    }
    return null;
  };
  await worker.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:''});
  const pkCanvas=cropImage(imgEl,0.24,0.24,0.52,0.11,3); preprocessBgDiff(pkCanvas,40,40);
  const pkText=(await worker.recognize(pkCanvas.toBuffer('image/png'))).data.text;
  let pkArr=_findPK(pkText);
  if(!pkArr){
    const pkCanvas2=cropImage(imgEl,0.24,0.24,0.52,0.11,3); preprocessInvert(pkCanvas2);
    pkArr=_findPK((await worker.recognize(pkCanvas2.toBuffer('image/png'))).data.text);
  }
  let leftPK=pkArr?pkArr[0]:null,rightPK=pkArr?pkArr[1]:null;
  if(leftScore!==null&&rightScore!==null&&leftScore!==rightScore){leftPK=null;rightPK=null;}

  /* HOME/AWAY バッジ判定 */
  const leftBadgeCanvas=cropImage(imgEl,0.02,0.19,0.44,0.05,1);
  const{leftIsHome}=detectLeftBadgeHome(leftBadgeCanvas);

  /* チーム名 */
  await worker.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:''});
  const leftNameCanvas=cropImage(imgEl,0.02,0.34,0.44,0.10,2);
  let leftTeamRaw=(await worker.recognize(leftNameCanvas.toBuffer('image/png'))).data.text.trim().replace(/\n/g,' ');
  const rightNameCanvas=cropImage(imgEl,0.54,0.34,0.43,0.10,2);
  let rightTeamRaw=(await worker.recognize(rightNameCanvas.toBuffer('image/png'))).data.text.trim().replace(/\n/g,' ');
  console.log(`[OCR] leftRaw="${leftTeamRaw}" rightRaw="${rightTeamRaw}" playerMapKeys=${Object.keys(playerMap).length}`);
  let leftTeamMatch=matchTeamName(leftTeamRaw,playerMap);
  let rightTeamMatch=matchTeamName(rightTeamRaw,playerMap);
  if(!leftTeamMatch){const retry=await retryTeamName(worker,imgEl,0.02,0.34,0.44,0.10,playerMap);if(retry.raw)leftTeamRaw=leftTeamRaw?`${leftTeamRaw} / ${retry.raw}`:retry.raw;if(retry.match)leftTeamMatch=retry.match;}
  if(!rightTeamMatch){const retry=await retryTeamName(worker,imgEl,0.54,0.34,0.43,0.10,playerMap);if(retry.raw)rightTeamRaw=rightTeamRaw?`${rightTeamRaw} / ${retry.raw}`:retry.raw;if(retry.match)rightTeamMatch=retry.match;}
  await worker.setParameters({tessedit_pageseg_mode:'3',tessedit_char_whitelist:''});
  if(leftTeamMatch&&rightTeamMatch&&leftTeamMatch.playerName===rightTeamMatch.playerName){leftTeamMatch=null;rightTeamMatch=null;}

  const homeScore=leftIsHome?leftScore:rightScore;
  const awayScore=leftIsHome?rightScore:leftScore;
  const homePK=leftIsHome?leftPK:rightPK;
  const awayPK=leftIsHome?rightPK:leftPK;
  const homeChar=leftIsHome?leftTeamMatch:rightTeamMatch;
  const awayChar=leftIsHome?rightTeamMatch:leftTeamMatch;

  console.log(`\n[OCR] ${scoreMethod} ${awayChar?.playerName||'?'}(${awayScore}) - ${homeChar?.playerName||'?'}(${homeScore}) PK:${awayPK}/${homePK}`);

  return { awayScore, homeScore, awayPK, homePK, awayChar, homeChar };
}

module.exports = { parseMatchResult };
