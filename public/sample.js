export const sentences = [
  {id: 's1', paragraph: 0, text: 'Det är en stilla morgon i Göteborg.'},
  {id: 's2', paragraph: 0, text: 'Jag tycker om att läsa medan staden vaknar.'},
  {id: 's3', paragraph: 1, text: 'Utanför fönstret skyndar människor till spårvagnen, med var sin kopp kaffe i händerna.'},
  {id: 's4', paragraph: 1, text: 'På bordet ligger en bok som jag lånade på biblioteket i går.'},
  {id: 's5', paragraph: 2, text: 'Ibland stöter jag på ett ord som jag inte förstår.'},
  {id: 's6', paragraph: 2, text: 'Då stannar jag upp, lyssnar på meningen och skriver en liten anteckning.'},
  {id: 's7', paragraph: 3, text: 'Det viktigaste är inte att förstå allting på en gång.'},
  {id: 's8', paragraph: 3, text: 'Det är att vara nyfiken och fortsätta, en sida i taget.'}
];

// Authored interaction fixtures. These are never represented as live AI output.
const rows = [
 ['stilla','calm; quiet','宁静的','stilla','adjective','Describes a peaceful morning. Stilla has the same form here for both en and ett nouns.','Det var en stilla kväll.'],
 ['morgon','morning','早晨','morgon','noun · en','En morgon; morgonen; morgnar. Here it is indefinite after en.','Vi ses i morgon.'],
 ['Göteborg','Gothenburg','哥德堡','Göteborg','place name','A city on the west coast of Sweden.','Hon bor i Göteborg.'],
 ['Jag','I','我','jag','pronoun','First-person singular subject pronoun.','Jag läser en bok.'],
 ['tycker','think; feel','认为；觉得','tycka','verb · present','In this sentence it belongs to tycker om, meaning like. Select both words for the complete expression.','Jag tycker om musik.'],
 ['om','part of tycker om: like','在 tycker om 中表示喜欢','om','particle','Here om belongs with tycker. Translating it alone as about would miss the meaning of the expression.','Hon tycker om att läsa.'],
 ['tycker om','like','喜欢','tycka om','verb phrase','Tycka om means to like. Tycker is present tense; om is part of the expression. Before another verb, use att.','Jag tycker om att promenera.'],
 ['läsa','read','阅读','läsa','verb · infinitive','Läsa follows att here. Common forms: läser, läste, läst.','Jag vill läsa den här boken.'],
 ['medan','while','当……的时候','medan','conjunction','Connects two actions happening at the same time.','Hon läser medan jag lagar mat.'],
 ['staden','the city','这座城市','stad','noun · definite','En stad → staden. The definite singular form refers to the city around the narrator.','Staden vaknar tidigt.'],
 ['vaknar','wakes up','醒来','vakna','verb · present','The city is described as waking up: people are beginning their day.','Jag vaknar klockan sju.'],
 ['fönstret','the window','窗户','fönster','noun · definite','Ett fönster → fönstret. The final -et marks the definite singular.','Öppna fönstret.'],
 ['skyndar','hurry','匆忙赶路','skynda','verb · present','Describes people moving quickly to catch the tram.','Vi skyndar till tåget.'],
 ['människor','people','人们','människa','noun · plural','En människa → människor. The plural form is indefinite here.','Det finns många människor här.'],
 ['spårvagnen','the tram','有轨电车','spårvagn','noun · definite','En spårvagn → spårvagnen. A compound of spår (track) and vagn (carriage).','Spårvagnen kommer snart.'],
 ['var sin','one each','各自一个','var sin','expression','Distributes one object to each person. Here each person has their own cup of coffee.','De tog var sin bok.'],
 ['kaffe','coffee','咖啡','kaffe','noun','The drink in each person’s cup.','Vill du ha kaffe?'],
 ['händerna','the hands','双手','hand','noun · definite plural','En hand → händer → händerna. Notice the vowel change in the plural.','Hon värmer händerna.'],
 ['bok','book','书','bok','noun · en','En bok; boken; böcker.','Det är en bra bok.'],
 ['lånade','borrowed','借了','låna','verb · past','The narrator borrowed the book from the library. Låna can mean borrow or lend depending on context.','Jag lånade en cykel.'],
 ['biblioteket','the library','图书馆','bibliotek','noun · definite','Ett bibliotek → biblioteket.','Vi träffas på biblioteket.'],
 ['i går','yesterday','昨天','i går','time expression','Refers to the day before today. Also commonly written igår.','Jag läste boken i går.'],
 ['Ibland','sometimes','有时','ibland','adverb','Signals that something happens occasionally.','Ibland läser jag på tåget.'],
 ['stöter','encounter','遇到','stöta','verb · present','Here it belongs to stöter på, meaning come across or encounter.','Vi stöter på ett problem.'],
 ['stöter jag på','I come across','我遇到','stöta på','verb phrase with subject','The subject jag appears between the verb and particle because Ibland comes first. The expression is stöta på.','Ibland stöter vi på nya ord.'],
 ['förstår','understand','理解','förstå','verb · present','Förstå → förstår → förstod → förstått. Inte makes the statement negative.','Jag förstår meningen.'],
 ['stannar jag upp','I pause','我停下来','stanna upp','verb phrase with subject','Stanna upp means pause or stop briefly. Jag is the subject inserted between the verb and particle.','Hon stannar upp och tänker.'],
 ['lyssnar','listen','听','lyssna','verb · present','Lyssna på means listen to.','Jag lyssnar på en berättelse.'],
 ['meningen','the sentence','这个句子','mening','noun · definite','En mening → meningen. Here it means sentence, rather than meaning or intention.','Läs meningen igen.'],
 ['anteckning','note','笔记','anteckning','noun · en','En anteckning; anteckningen; anteckningar.','Jag skriver en anteckning.'],
 ['viktigaste','most important thing','最重要的','viktig','adjective · superlative','Det viktigaste means the most important thing.','Det viktigaste är att försöka.'],
 ['på en gång','all at once','一下子；同时','på en gång','expression','Here it means understanding everything at once, rather than gradually.','Gör inte allt på en gång.'],
 ['nyfiken','curious','好奇的','nyfiken','adjective','Describes a desire to discover or learn. Forms include nyfiket and nyfikna.','Jag är nyfiken på språket.'],
 ['fortsätta','continue','继续','fortsätta','verb · infinitive','Fortsätta → fortsätter → fortsatte → fortsatt.','Vi vill fortsätta läsa.'],
 ['en sida i taget','one page at a time','一次一页','en sida i taget','expression','I taget means at a time, emphasizing gradual progress.','Läs en sida i taget.']
];
export function fixture(text, language = 'en') {
 const row = rows.find(r => r[0].toLocaleLowerCase('sv') === text.toLocaleLowerCase('sv'));
 if (!row) return null;
 return {translation: language === 'zh' ? row[2] : row[1], lemma:row[3], grammar:row[4], explanation:row[5], example:row[6], source:'demo', explanationLanguage:'en'};
}
export const passages = [
 {id:'narration', label:'Narration & rhythm', text: sentences.slice(0,4).map(s=>s.text).join(' ')},
 {id:'dialogue', label:'Dialogue & intonation', text:'”Vill du följa med till biblioteket?” frågade Elin. ”Gärna, men jag måste lämna tillbaka en bok först”, svarade Johan. ”Då tar vi spårvagnen tillsammans.”'},
 {id:'precision', label:'Names, numbers & compounds', text:'På torsdag den tjugotredje november tar sjuksköterskan Åsa tåget från Göteborg till Växjö klockan sjutton trettio. Biljetten kostar 245 kronor. Hon arbetar på en vårdcentral nära järnvägsstationen.'}
];
