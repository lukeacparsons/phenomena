// Calendar arithmetic uses Barcelona's local date, independent of DST or browser timezone.
const dateWords={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,un:1,una:1,uno:1,dos:2,tres:3,cuatro:4,quatre:4,cinco:5,cinc:5,seis:6,sis:6};
const weekdays={monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6,sunday:0,lunes:1,martes:2,miercoles:3,jueves:4,viernes:5,sabado:6,domingo:0,dilluns:1,dimarts:2,dimecres:3,dijous:4,divendres:5,dissabte:6,diumenge:0};
const foldDateText=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const dayShift=(date,amount)=>{const value=new Date(date+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+amount);return value.toISOString().slice(0,10);};
const monthShift=(date,amount)=>{const value=new Date(date+'T12:00:00Z'),day=value.getUTCDate();value.setUTCDate(1);value.setUTCMonth(value.getUTCMonth()+amount);const end=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,0)).getUTCDate();value.setUTCDate(Math.min(day,end));return value.toISOString().slice(0,10);};
const validDate=date=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;

export function parseDateQuery(input,today){
  const original=String(input||'');
  // Preserve accented names in the returned text; mask quoted titles from date parsing.
  let text=original.normalize('NFC'),scan=foldDateText(text),range=null,invalid=false;
  scan=scan.replace(/"[^"\n]*"|“[^”\n]*”/g,value=>' '.repeat(value.length));
  const weekday=new Date(today+'T12:00:00Z').getUTCDay();
  const monday=dayShift(today,-((weekday+6)%7));
  function take(regex,resolve){
    if(range||invalid)return;
    const match=regex.exec(scan);
    if(!match)return;
    const value=resolve(match);
    if(!value||!validDate(value.start)||!validDate(value.end)||value.end<value.start){invalid=true;return;}
    range=value;
    text=text.slice(0,match.index)+' '+text.slice(match.index+match[0].length);
  }
  const exact=date=>({start:date,end:date});
  take(/\b(?:from\s+|between\s+|del?\s+)?(\d{4}-\d{2}-\d{2})\s*(?:to|through|until|and|a|al|hasta|–|—|\.\.)\s*(\d{4}-\d{2}-\d{2})\b/,m=>({start:m[1],end:m[2]}));
  take(/\b(?:day after tomorrow|pasado manana|dema passat)\b/,()=>exact(dayShift(today,2)));
  take(/\b(?:today|hoy|avui)\s+(?:or|and|to|through|o|y|i|a)\s+(?:tomorrow|manana|dema)\b/,()=>({start:today,end:dayShift(today,1)}));
  take(/\b(?:in a fortnight|in two weeks[’'] time)\b/,()=>exact(dayShift(today,14)));
  const count='(\\d{1,3}|'+Object.keys(dateWords).join('|')+')';
  take(new RegExp('\\b(?:in|dentro de|d[’\']?aqui a|d aqui a)\\s+'+count+'\\s+(days?|weeks?|months?|dias?|dies|semanas?|setmanes?|mes(?:es|os)?)(?:\\s+(?:time|de temps))?\\b'),m=>{
    const n=Number(m[1])||dateWords[m[1]];
    if(!n||n>365)return null;
    return exact(/^(month|mes)/.test(m[2])?monthShift(today,n):dayShift(today,n*(/^(week|seman|setman)/.test(m[2])?7:1)));
  });
  take(new RegExp('\\b(?:next|proximos|proximas|properes|propers)\\s+'+count+'\\s+(days?|weeks?|dias?|dies|semanas?|setmanes?)\\b'),m=>{
    const n=Number(m[1])||dateWords[m[1]];
    return n&&n<=365?{start:today,end:dayShift(today,n*(/^(week|seman|setman)/.test(m[2])?7:1)-1)}:null;
  });
  take(/\b(?:next weekend|proximo fin de semana|proper cap de setmana)\b/,()=>({start:dayShift(monday,12),end:dayShift(monday,13)}));
  take(/\b(?:this weekend|este fin de semana|aquest cap de setmana)\b/,()=>({start:dayShift(monday,5),end:dayShift(monday,6)}));
  take(/\b(?:saturday\s+(?:or|and|to)\s+sunday|sabado\s+(?:o|y)\s+domingo|dissabte\s+(?:o|i)\s+diumenge)\b/,()=>({start:dayShift(monday,5),end:dayShift(monday,6)}));
  take(/\b(?:next week|la semana que viene|semana que viene|la proxima semana|proxima semana|la setmana que ve|setmana que ve|la setmana vinent|setmana vinent)\b/,()=>({start:dayShift(monday,7),end:dayShift(monday,13)}));
  take(/\b(?:this week|esta semana|aquesta setmana)\b/,()=>({start:monday,end:dayShift(monday,6)}));
  take(/\b(?:next month|el proximo mes|proximo mes|el mes que ve|mes que ve)\b/,()=>{const start=monthShift(today.slice(0,7)+'-01',1);return {start,end:dayShift(monthShift(start,1),-1)};});
  take(/\b(?:this month|este mes|aquest mes)\b/,()=>{const start=today.slice(0,7)+'-01';return {start,end:dayShift(monthShift(start,1),-1)};});
  take(/\b(?:today|tonight|hoy|avui|esta noche|aquesta nit)\b/,()=>exact(today));
  take(/\b(?:tomorrow|manana|dema)\b/,()=>exact(dayShift(today,1)));
  take(new RegExp('\\b(?:(this|next|este|el proximo|proximo|aquest|el proper|proper)\\s+)?('+Object.keys(weekdays).join('|')+')\\b'),m=>{
    let distance=(weekdays[m[2]]-weekday+7)%7;
    if(!distance&&/next|proximo|proper/.test(m[1]||''))distance=7;
    return exact(dayShift(today,distance));
  });
  // A bare ISO date selects screening dates; a bare year still searches release years.
  take(/\b(\d{4}-\d{2}-\d{2})\b/,m=>exact(m[1]));
  return {text:text.replace(/["“”]/g,'').replace(/\s+/g,' ').trim(),range};
}
