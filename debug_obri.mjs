const text = 'ماذا عن العبور للاستثمار العقاري';
const key = 'العبور للاستثمار العقاري';

const norm = text.replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').toLowerCase();
const normKey = key.replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').toLowerCase();
const esc = normKey.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const rx = new RegExp('(?:^|[^a-z0-9\u0600-\u06ff])' + esc + '(?:$|[^a-z0-9\u0600-\u06ff])','i');
console.log('norm text:', norm);
console.log('norm key:', normKey);
console.log('escaped:', esc);
console.log('match:', rx.test(norm));
