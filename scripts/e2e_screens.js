const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); }); p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  const out = "docs/screenshots/", U = "http://localhost:8000";
  await p.goto(U + "/story"); await p.waitForTimeout(800);
  await p.fill("textarea", "NIFTY falls 15% over 10 trading days, the rupee depreciates 4%, banking stocks experience high volatility, and crude oil increases 12%.");
  await p.click("text=Parse text"); await p.waitForSelector("text=Interpreted as"); await p.waitForTimeout(300);
  await p.screenshot({ path: out + "story.png", fullPage: true });
  await p.locator("button:has-text(\"GENERATE\")").click(); await p.waitForSelector("text=Scenario constraint satisfaction"); await p.waitForTimeout(1200);
  await p.screenshot({ path: out + "explorer.png", fullPage: true });
  for (const [name, path, wait] of [["overview", "/", "text=System status"], ["portfolio", "/portfolio", "text=VaR 95%"], ["model_lab", "/models", "text=Ablation studies"], ["data_research", "/research", "text=Methodology"]]) {
    await p.goto(U + path); await p.waitForSelector(wait, { timeout: 30000 }); await p.waitForTimeout(1500); await p.screenshot({ path: out + name + ".png", fullPage: true });
  }
  const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 844 });
  m.on("console", (x) => { if (x.type() === "error") errs.push("mobile console: " + x.text()); });
  await m.goto(U + "/portfolio"); await m.waitForSelector("text=VaR 95%"); await m.waitForTimeout(1200); await m.screenshot({ path: out + "mobile_portfolio.png", fullPage: true });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log("mobile horizontal overflow px:", overflow); console.log("ERRORS:", JSON.stringify(errs)); await b.close();
})();
