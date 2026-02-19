#!/usr/bin/env node
/**
 * Generates a test epub with sample text in multiple languages:
 * English, Spanish, Korean, Arabic, and Chinese.
 */
import JSZip from 'jszip';
import { writeFileSync, mkdirSync } from 'fs';

const chapters = [
  {
    id: 'english',
    title: 'English',
    body: `<h2>The Garden</h2>
<p>The old woman walked slowly through her garden every morning. She loved the way the sunlight filtered through the tall oak trees and made patterns on the ground. Her roses were blooming beautifully this year, filling the air with a sweet fragrance that reminded her of childhood summers.</p>
<p>She picked a handful of ripe tomatoes from the vine and placed them carefully in her basket. The neighbors often stopped by to admire her flowers and vegetables. She always sent them home with something fresh from the garden.</p>
<p>"There is nothing quite like growing your own food," she would say with a warm smile. "It teaches you patience and rewards you with flavor that no store can match."</p>`,
  },
  {
    id: 'spanish',
    title: 'Spanish (Español)',
    body: `<h2>El Mercado</h2>
<p>Cada domingo por la mañana, María caminaba hasta el mercado del pueblo. Las calles estaban llenas de colores y olores maravillosos. Los vendedores gritaban los precios de sus frutas y verduras frescas mientras la gente pasaba entre los puestos.</p>
<p>A ella le gustaba comprar naranjas de Valencia y aceitunas negras del sur. También buscaba queso fresco de cabra y pan recién horneado. El panadero siempre le guardaba una barra especial porque sabía que era su cliente más fiel.</p>
<p>"Buenos días, María. Aquí tienes tu pan favorito," decía él con una sonrisa amable. Ella le agradecía y continuaba su recorrido por el mercado, disfrutando de cada momento.</p>`,
  },
  {
    id: 'korean',
    title: 'Korean (한국어)',
    body: `<h2>서울의 아침</h2>
<p>서울의 아침은 언제나 활기차다. 사람들은 지하철역으로 빠르게 걸어가고 카페에서는 커피 향이 거리로 퍼져 나온다. 한강 근처의 공원에서는 어르신들이 태극권을 하고 있었다.</p>
<p>민수는 매일 아침 일찍 일어나서 한강을 따라 달리기를 한다. 그는 운동을 하면서 하루를 시작하는 것을 좋아한다. 달리기가 끝나면 근처 식당에서 따뜻한 된장찌개와 밥을 먹는다.</p>
<p>"오늘 날씨가 정말 좋네요," 민수가 식당 주인에게 말했다. "네, 봄이 드디어 왔어요. 벚꽃이 곧 피겠네요," 주인이 대답했다.</p>`,
  },
  {
    id: 'arabic',
    title: 'Arabic (العربية)',
    body: `<h2>في المدينة القديمة</h2>
<p>تتميز المدينة القديمة بأزقتها الضيقة وأسواقها التقليدية. كان أحمد يمشي ببطء بين المحلات الصغيرة ويستمتع بروائح التوابل والعطور المنبعثة من كل مكان. الشمس كانت تتسلل من بين الأسقف الخشبية القديمة.</p>
<p>توقف عند بائع الكتب القديمة واشترى رواية عربية كلاسيكية. كان يحب القراءة في المقهى الصغير بجوار النافورة حيث يشرب الشاي بالنعناع ويقرأ حتى غروب الشمس.</p>
<p>"هذا الكتاب من أجمل ما كتب في الأدب العربي،" قال البائع. "ستستمتع بكل صفحة فيه." ابتسم أحمد وشكره على النصيحة.</p>`,
  },
  {
    id: 'chinese',
    title: 'Chinese (中文)',
    body: `<h2>北京的胡同</h2>
<p>北京的胡同是这座城市最有魅力的地方之一。狭窄的巷道两旁是传统的四合院，红色的大门上贴着对联。清晨的阳光照在灰色的砖墙上，给古老的建筑增添了一层温暖的光芒。</p>
<p>李阿姨每天早上都会在胡同口的小摊上买豆浆和油条。她认识这里的每一个邻居，大家见面都会互相问好。孩子们在巷子里追逐玩耍，老人们坐在门前下棋聊天。</p>
<p>"这条胡同已经有三百多年的历史了，"李阿姨对来参观的游客说。"虽然城市在不断变化，但这里的生活方式一直没有改变。"</p>`,
  },
];

async function build() {
  const zip = new JSZip();

  // mimetype must be first and uncompressed
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // Container
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  // OPF
  const manifest = chapters.map(c =>
    `    <item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`
  ).join('\n');
  const spine = chapters.map(c => `    <itemref idref="${c.id}"/>`).join('\n');

  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">hilight-test-multilingual</dc:identifier>
    <dc:title>Hilight Test — Multilingual Samples</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>hilight</dc:creator>
    <meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifest}
  </manifest>
  <spine>
${spine}
  </spine>
</package>`);

  // Nav
  const navItems = chapters.map(c =>
    `      <li><a href="${c.id}.xhtml">${c.title}</a></li>`
  ).join('\n');

  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Table of Contents</title></head>
<body>
  <nav epub:type="toc">
    <h1>Table of Contents</h1>
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>`);

  // Chapter files
  for (const ch of chapters) {
    zip.file(`OEBPS/${ch.id}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${ch.title}</title>
  <style>
    body { font-family: serif; line-height: 1.8; padding: 20px; max-width: 700px; margin: 0 auto; }
    h2 { margin-bottom: 16px; }
    p { margin-bottom: 14px; text-align: justify; }
  </style>
</head>
<body>
${ch.body}
</body>
</html>`);
  }

  const buf = await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
  mkdirSync('public', { recursive: true });
  writeFileSync('public/test-multilingual.epub', buf);
  console.log('Created public/test-multilingual.epub');
}

build().catch(console.error);
