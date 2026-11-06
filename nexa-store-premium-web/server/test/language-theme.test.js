import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const webRoot=path.resolve(here,'../../');

test('storefront language script covers the complete UI dictionary, editable fields and digits',async()=>{
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 assert.doesNotThrow(()=>new vm.Script(source,{filename:'nexa-store-language.js'}));
 for(const phrase of ['إنشاء فاتورة شحن','توثيق الهوية','فتح القائمة الجانبية','لا توجد أقسام منشورة حالياً','استكشف المتجر']){
  assert.ok(source.includes(phrase),'Missing Arabic UI translation: '+phrase);
 }
 assert.ok(source.includes("const excludedSelector = 'script,style,code,pre,[data-no-translate]'"),
  'Input and textarea placeholders must remain eligible for attribute translation');
 assert.ok(source.includes('function localizeDigits('),'Digits must be localized for both supported languages');
 assert.ok(source.includes("localizeDigits(language==='en'?translated(original):original,language)"),
  'Every translated text node must use the active digit system');
 assert.ok(source.includes('translationLookup[key]'),'The extended translation dictionary must be consulted');
});

test('language direction moves the drawer rail and closes the mobile drawer before changing language',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-polish.css'),'utf8');
 assert.ok(store.includes("if(window.matchMedia('(max-width: 1024px)').matches)closeMenu(true);"),
  'Language switching closes the mobile drawer before changing direction');
 assert.ok(css.includes(':root[dir="ltr"] .app-shell .sidebar{'),'English uses a left-side drawer');
 assert.ok(css.includes('transform:translate3d(-110%,0,0)!important'),'The left-side drawer moves off-canvas in English');
 assert.ok(css.includes(':root[dir="rtl"] .app-shell .sidebar{'),'Arabic retains a right-side drawer');
 assert.ok(css.includes('text-align:start!important'),'Text alignment follows active direction');
});

test('theme switch is a moving sun/moon control and storefront panels use theme variables',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-polish.css'),'utf8');
 const start=store.indexOf('id="storeThemeToggle"');
 const markup=store.slice(start,start+1400);
 assert.ok(markup.includes('sidebar-theme-switch'),'Theme switch track exists');
 assert.ok(markup.includes('sidebar-theme-switch-knob'),'Theme switch has a moving knob');
 assert.ok(markup.includes('sidebar-theme-sun')&&markup.includes('sidebar-theme-moon'),'Sun and moon icons are included');
 assert.ok(css.includes(':root[data-theme="dark"] .app-shell .sidebar .sidebar-theme-switch-knob'),'Dark mode moves knob to the moon side');
 assert.ok(css.includes(':root[data-theme="light"] .app-shell .sidebar .sidebar-theme-switch-knob'),'Light mode moves knob to the sun side');
 assert.ok(css.includes('background:var(--surface)!important;color:var(--ink)!important'),'Panels use active theme variables');
 assert.ok(store.includes("setStoreColorMode(document.documentElement.dataset.theme||'dark',{persist:false})"),
  'Theme labels are synchronized when language changes');
});
