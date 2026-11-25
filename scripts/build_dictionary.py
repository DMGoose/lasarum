"""Convert the official Folkets sv-en XML into the app's offline dataset.

Usage: python scripts/build_dictionary.py [path/to/folkets_sv_en_public.xml]
The derived dictionary data retains CC BY-SA 2.5. App code is separate.
"""
from pathlib import Path
import hashlib
import html
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / '.dictionary-source/folkets_sv_en_public.xml'
root = ET.parse(source).getroot()
POS = {'nn': 'noun', 'vb': 'verb', 'jj': 'adjective', 'ab': 'adverb', 'pp': 'preposition', 'pn': 'pronoun', 'kn': 'conjunction', 'sn': 'conjunction', 'in': 'interjection', 'rg': 'numeral', 'pm': 'proper noun', 'article': 'article', 'abbrev': 'abbreviation', 'prefix': 'prefix', 'suffix': 'suffix', 'hp': 'pronoun', 'ps': 'possessive pronoun', 'ie': 'infinitive marker'}
def clean(value):
    return unicodedata.normalize('NFC', html.unescape(html.unescape(value or ''))).replace('|', '').strip()
def key(value):
    return ' '.join(clean(value).lower().split())
entries, index = [], {}
for word in root.findall('word'):
    lemma = clean(word.get('value'))
    translations = list(dict.fromkeys(clean(t.get('value')) for t in word.findall('translation') if clean(t.get('value'))))
    if not lemma or not translations or len(lemma) > 250:
        continue
    examples = []
    for example in word.findall('example'):
        sv = clean(example.get('value'))
        en = '; '.join(clean(t.get('value')) for t in example.findall('translation') if clean(t.get('value')))
        if sv and en:
            examples.append([sv, en])
        if len(examples) == 2:
            break
    record_id = len(entries)
    entries.append([lemma, POS.get(word.get('class'), 'phrase' if ' ' in lemma else 'word'), translations[:8], examples])
    forms = {lemma}
    for form in list(word.findall('./paradigm/inflection')) + list(word.findall('variant')):
        for value in re.split(r'[,;/]', clean(form.get('value'))):
            value = value.strip()
            if value and not value.startswith('-') and not re.search(r'[(){}~*]', value) and len(value) <= 250:
                forms.add(value)
    for form in forms:
        normalized = key(form)
        if normalized and record_id not in index.setdefault(normalized, []):
            index[normalized].append(record_id)

checksum = hashlib.sha256(source.read_bytes()).hexdigest()
version = 'folkets-' + root.get('version', 'unknown') + '-compact-v1-' + checksum[:12]
metadata = {
    'version': version, 'name': 'Folkets lexikon', 'sourceLanguage': 'sv', 'targetLanguage': 'en',
    'sourceUrl': 'https://folkets-lexikon.csc.kth.se/folkets/om.en.html',
    'downloadUrl': 'https://folkets-lexikon.csc.kth.se/folkets/folkets_sv_en_public.xml',
    'license': 'CC BY-SA 2.5', 'licenseUrl': 'https://creativecommons.org/licenses/by-sa/2.5/',
    'attribution': "Folkets lexikon / The People's Dictionary, based on Lexin from the Swedish Language Council; developed by Viggo Kann and Joachim Hollman / Algoritmica HB and hosted by KTH Royal Institute of Technology. See source for full contributors.",
    'modifications': 'Läsrum compact JSON conversion: translated entries, part-of-speech labels, spelling/inflection index, and up to two bilingual examples per entry. The derived data remains CC BY-SA 2.5.',
    'sourceUpdated': root.get('last-changed'), 'sourceSHA256': checksum,
    'entryCount': len(entries), 'formCount': len(index),
}
output = ROOT / 'public'
(output / 'dictionary-data.json').write_text(json.dumps({'version': version, 'entries': entries, 'index': index}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
(output / 'dictionary-meta.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'entries': len(entries), 'forms': len(index), 'bytes': (output / 'dictionary-data.json').stat().st_size, 'version': version}))
