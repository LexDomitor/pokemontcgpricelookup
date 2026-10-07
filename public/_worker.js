import {handleApi} from './api.mjs';
export default {async fetch(request,env){return new URL(request.url).pathname.startsWith('/api/')?handleApi(request):env.ASSETS.fetch(request);}};
