from pathlib import Path
p=Path("nexa-store-premium-web/server/src/server.js")
s=p.read_text()
old="server.listen(cfg.port,()=>console.log(`Nexa server listening on ${cfg.port}; paymentsReady=${paymentsReady}`));"
new="""server.listen(cfg.port,()=>{
  console.log(`Nexa server listening on ${cfg.port}; paymentsReady=${paymentsReady}`);
  console.log('Nexa payment config flags:', JSON.stringify({
    paymentsEnabled:cfg.paymentsEnabled,
    databaseConfigured:Boolean(cfg.databaseUrl),
    apiTokenConfigured:Boolean(cfg.apiToken),
    apiTokenLengthValid:Boolean(cfg.apiToken && Buffer.byteLength(cfg.apiToken) <= 256),
    walletIdConfigured:Boolean(cfg.walletId),
    fxRateConfigured:Number.isFinite(cfg.sypPerUsd) && cfg.sypPerUsd > 0,
    fxTimestampValid:Number.isFinite(new Date(cfg.fxUpdatedAt).getTime()),
    fxSourceConfigured:Boolean(cfg.fxSource),
    ttlValid:Number.isInteger(cfg.orderTtlMinutes) && cfg.orderTtlMinutes >= 5 && cfg.orderTtlMinutes <= 1440,
    timezoneValid:Number.isInteger(cfg.timezoneOffsetMinutes) && Math.abs(cfg.timezoneOffsetMinutes) <= 840
  }));
});"""
if s.count(old)!=1: raise SystemExit(f"expected one server.listen, found {s.count(old)}")
p.write_text(s.replace(old,new))
print("Added non-secret readiness flags to startup logs.")
