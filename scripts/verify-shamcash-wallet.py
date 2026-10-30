from pathlib import Path
p=Path("nexa-store-premium-web/server/src/server.js")
s=p.read_text()
old="""  }));
});"""
new="""  }));
  if (paymentsReady) {
    getWallet(true)
      .then(() => console.log('Sham Cash wallet API check: active'))
      .catch(error => console.error('Sham Cash wallet API check failed:', error.code || 'UNKNOWN'));
  }
});"""
if s.count(old)!=1: raise SystemExit(f"expected one diagnostic block end, found {s.count(old)}")
p.write_text(s.replace(old,new))
print("Added one non-financial GET wallets check at server startup.")
