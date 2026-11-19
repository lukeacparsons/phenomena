const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const context=vm.createContext({Date});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/search-dates.js'),'utf8').replace(/^export /gm,''),context);
function parse(text,today='2026-11-19'){
  context.input=text;context.today=today;
  return JSON.parse(vm.runInContext('JSON.stringify(parseDateQuery(input,today))',context));
}
const cases=[
  ['today','2026-11-19','2026-11-19'],['tomorrow','2026-11-20','2026-11-20'],['tonight','2026-11-19','2026-11-19'],
  ['day after tomorrow','2026-11-21','2026-11-21'],['today or tomorrow','2026-11-19','2026-11-20'],
  ['this week','2026-11-16','2026-11-22'],['next week','2026-11-23','2026-11-29'],
  ['in 2 weeks time','2026-12-03','2026-12-03'],['in two weeks','2026-12-03','2026-12-03'],['in a week','2026-11-26','2026-11-26'],
  ['next 2 weeks','2026-11-19','2026-12-02'],['in 3 days','2026-11-22','2026-11-22'],
  ['this weekend','2026-11-21','2026-11-22'],['next weekend','2026-11-28','2026-11-29'],
  ['saturday','2026-11-21','2026-11-21'],['sunday','2026-11-22','2026-11-22'],['Monday','2026-11-23','2026-11-23'],
  ['Saturday or Sunday','2026-11-21','2026-11-22'],
  ['this Thursday','2026-11-19','2026-11-19'],['next Thursday','2026-11-26','2026-11-26'],
  ['this month','2026-11-01','2026-11-30'],['next month','2026-12-01','2026-12-31'],
  ['2026-12-01','2026-12-01','2026-12-01'],['from 2026-11-20 to 2026-11-22','2026-11-20','2026-11-22'],
  ['mañana','2026-11-20','2026-11-20'],['la semana que viene','2026-11-23','2026-11-29'],['dentro de dos semanas','2026-12-03','2026-12-03'],
  ['dissabte','2026-11-21','2026-11-21'],['diumenge','2026-11-22','2026-11-22'],['aquesta setmana','2026-11-16','2026-11-22'],
  ["d'aquí a 2 setmanes",'2026-12-03','2026-12-03']
];
for(const [text,start,end] of cases)assert.deepEqual(parse(text),{text:'',range:{start,end}},text);
assert.deepEqual(parse('comedy Saturday'),{text:'comedy',range:{start:'2026-11-21',end:'2026-11-21'}});
assert.deepEqual(parse('Timothée Chalamet tomorrow'),{text:'Timothée Chalamet',range:{start:'2026-11-20',end:'2026-11-20'}});
assert.deepEqual(parse('"The Day After Tomorrow" tomorrow'),{text:'The Day After Tomorrow',range:{start:'2026-11-20',end:'2026-11-20'}});
for(const text of ['1999','Tomorrowland','"Tomorrow"','in 999 weeks','2026-02-30','2026-11-22 to 2026-11-20'])assert.equal(parse(text).range,null,text);
assert.equal(parse('tomorrow','2026-12-31').range.start,'2027-01-01');
assert.equal(parse('in a month','2026-01-31').range.start,'2026-02-28');
assert.equal(parse('tomorrow','2026-03-28').range.start,'2026-03-29');
assert.equal(parse('in 2 days','2026-03-28').range.start,'2026-03-30');
assert.equal(parse('sunday','2026-11-22').range.start,'2026-11-22');
assert.equal(parse('next sunday','2026-11-22').range.start,'2026-11-29');
console.log('Date search: relative dates, ranges, weekdays, languages, quoted titles, invalid input and calendar boundaries passed.');
