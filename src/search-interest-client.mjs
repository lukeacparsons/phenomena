// Read-only aggregate requests. Credentials and responses never enter public data.
export function posthogAPI(key){
  if(!key||/[\r\n]/.test(key))throw Error('PostHog unavailable');
  const project=process.env.POSTHOG_PROJECT_ID||'751818';
  if(!/^\d+$/.test(project))throw Error('Invalid PostHog project');
  return async(path,{method='GET',body}={})=>{
    if(path!=='/query/'||method!=='POST')throw Error('Only aggregate queries are supported');
    const response=await fetch('https://us.posthog.com/api/projects/'+project+path,{method,redirect:'error',signal:AbortSignal.timeout(60000),
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw Error('PostHog unavailable');return response.json();
  };
}
