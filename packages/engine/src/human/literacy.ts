// 儿童识字量近似模型：常用字表（按频率排序的前约 1000 字）。识字量 < 表长时，只认识前 N 个字。
// 依据：小学语文课标「认识常用汉字」的分学段要求（一二年级约 1600 字，其中会写 800 字）。这里是近似，不是严格测量。
const COMMON = '的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山五太水万市眼体别处总才场师书比住员九笑性通目华报立马命张活难神数件安表原车白应路期叫死常提感金何更反合放做系计或司利受光王果亲界及今京务制解各任至清物台象记边共风战干接它许八特觉望直服毛林题建南度统色字请交爱让认算论百吃义科怎元社术结六功指思非流每青管夫连远资队跟带花快条院变联言权往展该领传近留红治决周保达办运武半候七必城父强步完革深区即求品士转量空甚众技轻程告江语英基派满式李息写呢识极令黄德收脸钱党倒未持取设始版双历越史商千片容研像找友孩站广改议形委早房音火际则首单据导影失拿网香似斯专石若兵弟谁校读志飞观争究包组造落视济喜离虽坐集编宝谈府拉黑且随格尽剑讲布杀微怕母调局根曾准团段终乐切级克精哪官示冷域假拍拜热备杂际术星笑朋玩鸟鱼熊';
const RANK = new Map<string, number>([...COMMON].map((c, i) => [c, i]));

/** 把超出识字量的汉字替换为 □，模拟「看不懂」 */
export function filterByLiteracy(text: string, literacyChars?: number): { text: string; unknownRatio: number } {
  if (!literacyChars || literacyChars >= 2500) return { text, unknownRatio: 0 };
  const limit = Math.round((literacyChars / 2500) * COMMON.length);
  let unknown = 0; let han = 0;
  const out = [...text].map((c) => {
    if (!/[一-鿿]/.test(c)) return c;
    han++;
    const r = RANK.get(c);
    if (r === undefined || r >= limit) { unknown++; return '□'; }
    return c;
  }).join('');
  return { text: out, unknownRatio: han ? unknown / han : 0 };
}
