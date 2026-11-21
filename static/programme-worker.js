import {prepareProgramme} from './programme-loader.js';
import {readProgrammeCache,saveProgrammeCache} from './programme-cache.js';

self.onmessage=async({data:{id,operation,text,cacheKey,cinemaId}})=>{
  try{
    const raw=operation==='cache'?await readProgrammeCache(cacheKey):JSON.parse(text);
    if(!raw){self.postMessage({id,done:true});return;}
    if(operation!=='cache')void saveProgrammeCache(cacheKey,raw);
    const {programme,index}=prepareProgramme(raw,cinemaId);
    const {films,search,...metadata}=programme;
    const {programme:unused,films:indexed,cinemas,...indexMetadata}=index;
    self.postMessage({id,header:{programme:{...metadata,films:[],search:{...search,films:[]}},index:{...indexMetadata,films:[]}}});
    const current=new Map(films.map((film,position)=>[film.id,{film,position}]));
    const archived=new Map((search?.films||[]).map((film,position)=>[film.id,{film,position}]));
    for(let start=0;start<indexed.length;start+=3){
      const rows=indexed.slice(start,start+3).map(row=>({indexed:row,current:current.get(row.film.id)?.film,currentPosition:current.get(row.film.id)?.position,archived:archived.get(row.film.id)?.film,archivePosition:archived.get(row.film.id)?.position}));
      self.postMessage({id,rows});
    }
    self.postMessage({id,done:true});
  }catch{self.postMessage({id,error:true});}
};
