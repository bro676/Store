const MAX_FAVORITES=200;
const MAX_FAVORITE_ID_LENGTH=120;
const hasOwn=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
function isRecord(value){return Boolean(value&&typeof value==='object'&&!Array.isArray(value))}
function cleanStoredFavorites(value){
 if(!Array.isArray(value))return [];
 const result=[];
 for(const entry of value){
  if(typeof entry!=='string')continue;
  const id=entry.trim();
  if(!id||id.length>MAX_FAVORITE_ID_LENGTH||/[\u0000-\u001f\u007f]/.test(id)||result.includes(id))continue;
  result.push(id);if(result.length>=MAX_FAVORITES)break;
 }
 return result;
}
export function normalizeCustomerPreferences(value){
 const source=isRecord(value)?value:{};
 const preferences={favorites:cleanStoredFavorites(source.favorites)};
 if(source.locale==='ar'||source.locale==='en')preferences.locale=source.locale;
 if(source.theme==='dark'||source.theme==='light')preferences.theme=source.theme;
 preferences.displayCurrency='SYP'; // The storefront now uses Syrian pounds only.
 return preferences;
}
function invalidPreferences(){return Object.assign(new Error('INVALID_CUSTOMER_PREFERENCES'),{status:400,code:'INVALID_CUSTOMER_PREFERENCES'})}
export function mergeCustomerPreferences(current,patch){
 if(!isRecord(patch))throw invalidPreferences();
 const next=normalizeCustomerPreferences(current);
 if(hasOwn(patch,'locale')){if(!['ar','en'].includes(patch.locale))throw invalidPreferences();next.locale=patch.locale;}
 if(hasOwn(patch,'theme')){if(!['dark','light'].includes(patch.theme))throw invalidPreferences();next.theme=patch.theme;}
 if(hasOwn(patch,'displayCurrency')){if(patch.displayCurrency!=='SYP')throw invalidPreferences();next.displayCurrency='SYP';}
 if(hasOwn(patch,'favorites')){
  if(!Array.isArray(patch.favorites)||patch.favorites.length>MAX_FAVORITES)throw invalidPreferences();
  const favorites=[];
  for(const entry of patch.favorites){
   if(typeof entry!=='string')throw invalidPreferences();
   const id=entry.trim();
   if(!id||id.length>MAX_FAVORITE_ID_LENGTH||/[\u0000-\u001f\u007f]/.test(id))throw invalidPreferences();
   if(!favorites.includes(id))favorites.push(id);
  }
  next.favorites=favorites;
 }
 return next;
}
