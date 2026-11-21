import {parseLanguages} from './screening-language.js';

const supported=new Set(['en','es','ca']);
export function suggestionLanguage(selected,browserLanguages=[]){
  for(const value of [selected,...browserLanguages]){
    const code=String(value||'').trim().toLowerCase().split(/[-_;]/)[0];
    if(supported.has(code))return code;
  }
  return 'en';
}
export function preferredAudioLanguages(selected,browserLanguages=[]){
  return [...new Set([selected,...browserLanguages].flatMap(value=>parseLanguages(String(value||'').split(/[-_;]/)[0]).codes))];
}
const genres={
  Comedy:['Comedy films','Películas de comedia','Pel·lícules de comèdia'],Documentary:['Documentaries','Documentales','Documentals'],
  Thriller:['Thriller films','Películas de suspense','Pel·lícules de suspens'],Drama:['Drama films','Dramas','Drames'],
  Horror:['Horror films','Películas de terror','Pel·lícules de terror'],Romance:['Romantic films','Películas románticas','Pel·lícules romàntiques'],
  Animation:['Animated films','Películas de animación','Pel·lícules d’animació'], 'Science fiction':['Science fiction films','Ciencia ficción','Ciència ficció'],
  Family:['Family films','Cine familiar','Cinema familiar'],Action:['Action films','Películas de acción','Pel·lícules d’acció'],
  Adventure:['Adventure films','Películas de aventuras','Pel·lícules d’aventures'],Mystery:['Mystery films','Películas de misterio','Pel·lícules de misteri'],
  Fantasy:['Fantasy films','Películas de fantasía','Pel·lícules de fantasia'],War:['War films','Cine bélico','Cinema bèl·lic'],
  Musical:['Musical films','Musicales','Musicals'],Western:['Western films','Western','Western'],Anime:['Anime films','Anime','Anime']
};
genres['Mystery & Thriller']=genres.Thriller;
const countryCodes={France:'FR',Japan:'JP',Spain:'ES',Italy:'IT',Germany:'DE','South Korea':'KR','United States':'US','United Kingdom':'GB',China:'CN',Portugal:'PT',Mexico:'MX',Argentina:'AR',Canada:'CA',Brazil:'BR',India:'IN',Iran:'IR',Belgium:'BE',Australia:'AU',Ireland:'IE',Sweden:'SE',Norway:'NO',Denmark:'DK',Finland:'FI',Netherlands:'NL',Poland:'PL',Turkey:'TR',Russia:'RU',Ukraine:'UA',Switzerland:'CH',Austria:'AT',Greece:'GR',Hungary:'HU',Romania:'RO',Chile:'CL',Colombia:'CO',Peru:'PE',Taiwan:'TW','Hong Kong':'HK','New Zealand':'NZ',Singapore:'SG','Central African Republic':'CF','Democratic Republic of the Congo':'CD',Czechia:'CZ','Czech Republic':'CZ'};
const englishCountries={France:'French films',Japan:'Japanese films',Spain:'Spanish films',Italy:'Italian films',Germany:'German films','South Korea':'Korean films','United States':'American films','United Kingdom':'British films'};
export function suggestionPhrases(language='en'){
  const locale=suggestionLanguage(language),i=['en','es','ca'].indexOf(locale),pick=values=>values[i];
  const languageNames=new Intl.DisplayNames([locale],{type:'language'}),countryNames=new Intl.DisplayNames([locale],{type:'region'});
  const languageName=value=>{const code=parseLanguages(value).codes[0];return code?languageNames.of(code):value;};
  const films=pick(['Films','Películas','Pel·lícules']);
  return {locale,films,film:pick(['Film','Película','Pel·lícula']),cinema:pick(['Cinema','Cine','Cinema']),directorRole:pick(['Director','Director','Director']),actorRole:pick(['Actor','Actor','Actor']),
    languageName,date:value=>({tonight:['tonight','esta noche','aquesta nit'],'this weekend':['this weekend','este fin de semana','aquest cap de setmana'],today:['today','hoy','avui'],tomorrow:['tomorrow','mañana','demà']}[value]||[value,value,value])[i],
    audio:(value,subject=films)=>subject+pick([' in ',' en ',' en '])+languageName(value),
    subtitles:value=>locale==='en'?languageName(value)+' subtitles':pick(['','Subtítulos en ','Subtítols en '])+languageName(value),
    withSubtitles:(subject,value)=>subject+pick([' with ',' con ',' amb '])+(locale==='en'?languageName(value)+' subtitles':pick(['','subtítulos en ','subtítols en '])+languageName(value)),
    at:(subject,venue)=>subject+pick([' at ',' en ',' a '])+venue,
    near:subject=>subject+pick([' near me',' cerca de mí',' a prop meu']),
    director:name=>films+pick([' directed by ',' dirigidas por ',' dirigides per '])+name,
    actor:name=>films+pick([' starring ',' con ',' amb '])+name,
    genre:value=>genres[value]?.[i]||(locale==='en'?value+' films':null),
    country:value=>locale==='en'?(englishCountries[value]||'Films from '+value):countryCodes[value]?films+' de '+countryNames.of(countryCodes[value]):null,
    under:(value,hours=false)=>pick(['Under ','Menos de ','Menys de '])+value+pick([hours?' hours':' minutes',hours?' horas':' minutos',hours?' hores':' minuts']),
    rating:(source,value)=>source+pick([' above ',' más de ',' més de '])+value,
    time:(value,before=false)=>films+(before?pick([' before ',' antes de las ',' abans de les ']):pick([' after ',' después de las ',' després de les ']))+value,
    format:value=>locale==='en'?value+' films':films+' en '+value
  };
}
