// SourceCalc - 1688 Profit Calculator
// Content script: runs on 1688.com product pages

(function() {
  'use strict';

  // Shipping rates (USD per kg, estimated averages for small parcels)
  const SHIPPING_RATES = {
    'us': { air: 8.5, sea: 2.5, name: 'USA / 美国' },
    'uk': { air: 9.0, sea: 3.0, name: 'UK / 英国' },
    'de': { air: 9.0, sea: 3.0, name: 'Germany / 德国' },
    'jp': { air: 6.5, sea: 2.0, name: 'Japan / 日本' },
    'au': { air: 8.0, sea: 2.8, name: 'Australia / 澳洲' },
    'ae': { air: 7.0, sea: 2.5, name: 'UAE / 阿联酋' },
    'sa': { air: 7.5, sea: 2.8, name: 'Saudi / 沙特' },
  };

  // Platform fee structures
  const PLATFORMS = {
    'amazon': { name: 'Amazon FBA', referralFee: 0.15, fbaFee: 5.50 },
    'amazon_fbm': { name: 'Amazon FBM', referralFee: 0.15, fbaFee: 0 },
    'shopify': { name: 'Shopify', referralFee: 0.029, fbaFee: 0 },
    'temu': { name: 'Temu', referralFee: 0.15, fbaFee: 0 },
    'ebay': { name: 'eBay', referralFee: 0.1289, fbaFee: 0 },
    'tiktok': { name: 'TikTok Shop', referralFee: 0.08, fbaFee: 0 },
  };

  const DUTY_RATE = 0.08;
  let exchangeRate = 0.137;

  // Fetch exchange rate from background
  try {
    chrome.runtime.sendMessage({ type: 'getExchangeRate' }, (response) => {
      if (response && response.rate) exchangeRate = response.rate;
    });
  } catch (e) {}

  // --- PRICE DETECTION (multiple strategies) ---
  function extractProductPrice() {
    // Strategy 1: CSS selectors for known 1688 layouts
    const selectors = [
      '.price-text',
      '.price .value',
      '.mod-detail-price .value',
      '.price-original-sku .value',
      '.app-common_supplyPrice__price',
      '[class*="supplyPrice"] [class*="price"]',
      '[class*="offerPrice"]',
      '[class*="skuPrice"]',
      '[data-role="price"]',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent.trim();
        const match = text.match(/([\d]+\.?\d*)/);
        if (match && parseFloat(match[1]) > 0) return parseFloat(match[1]);
      }
    }

    // Strategy 2: Find elements with class containing "price" and extract numbers
    const priceEls = document.querySelectorAll('[class*="price"], [class*="Price"]');
    for (const el of priceEls) {
      const text = el.textContent.trim();
      // Match ¥XX.XX pattern
      const yenMatch = text.match(/¥\s*([\d]+\.?\d*)/);
      if (yenMatch && parseFloat(yenMatch[1]) > 0.1 && parseFloat(yenMatch[1]) < 100000) {
        return parseFloat(yenMatch[1]);
      }
    }

    // Strategy 3: Walk text nodes looking for ¥ followed by number
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const candidates = [];
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      const match = text.match(/¥\s*([\d]+\.?\d{0,2})/);
      if (match && text.length < 30) {
        const val = parseFloat(match[1]);
        if (val > 0.1 && val < 100000) {
          candidates.push(val);
        }
      }
    }
    // Return the first (usually most prominent) price
    if (candidates.length > 0) return candidates[0];

    // Strategy 4: Look for data attributes
    const dataEls = document.querySelectorAll('[data-price], [data-value]');
    for (const el of dataEls) {
      const val = parseFloat(el.getAttribute('data-price') || el.getAttribute('data-value'));
      if (val > 0.1 && val < 100000) return val;
    }

    return null;
  }

  function extractProductTitle() {
    const selectors = [
      'h1.title-text',
      '.mod-detail-title h1',
      'h1[class*="title"]',
      '.title-con',
      '[class*="offerTitle"]',
      '[class*="detailTitle"]',
      'h1',
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) {
        const text = el.textContent.trim();
        if (text.length > 3 && text.length < 300) return text.substring(0, 80);
      }
    }
    return document.title.split('-')[0].trim().substring(0, 80) || '产品';
  }

  function calculate(params) {
    const { unitPriceCNY, quantity, weightKg, sellingPriceUSD, market, platform, shippingMethod } = params;

    const shippingRate = SHIPPING_RATES[market][shippingMethod];
    const platformFees = PLATFORMS[platform];

    const sourcingCostUSD = unitPriceCNY * exchangeRate;
    const shippingPerUnit = weightKg * shippingRate;
    const customsDuty = sourcingCostUSD * DUTY_RATE;
    const platformReferral = sellingPriceUSD * platformFees.referralFee;
    const fbaFee = platformFees.fbaFee;

    const totalCost = sourcingCostUSD + shippingPerUnit + customsDuty + platformReferral + fbaFee;
    const profit = sellingPriceUSD - totalCost;
    const margin = sellingPriceUSD > 0 ? (profit / sellingPriceUSD * 100) : 0;
    const roi = totalCost > 0 ? (profit / totalCost * 100) : 0;

    return {
      sourcingCostUSD: sourcingCostUSD.toFixed(2),
      shippingPerUnit: shippingPerUnit.toFixed(2),
      customsDuty: customsDuty.toFixed(2),
      platformReferral: platformReferral.toFixed(2),
      fbaFee: fbaFee.toFixed(2),
      totalCost: totalCost.toFixed(2),
      profit: profit.toFixed(2),
      margin: margin.toFixed(1),
      roi: roi.toFixed(1),
      totalInvestment: (totalCost * quantity).toFixed(2),
      totalProfit: (profit * quantity).toFixed(2),
    };
  }

  function createPanel() {
    // Don't create duplicate panels
    if (document.getElementById('sourcecalc-panel')) return;

    const detectedPrice = extractProductPrice();
    const productTitle = extractProductTitle();

    const panel = document.createElement('div');
    panel.id = 'sourcecalc-panel';
    panel.innerHTML = `
      <div class="sc-header">
        <h3>SourceCalc</h3>
        <button class="sc-close-btn" id="sc-close">\u00d7</button>
      </div>
      <div class="sc-body">
        ${detectedPrice ? `
          <div class="sc-detected">
            检测到价格: <strong>\u00a5${detectedPrice}</strong>
            <br><span style="font-size:11px;color:#666;">${productTitle}</span>
          </div>
        ` : `
          <div class="sc-detected" style="background:#fff7ed;border-color:#fed7aa;">
            <strong>未检测到价格</strong>，请手动输入
          </div>
        `}

        <div class="sc-section">
          <div class="sc-section-title">采购 Sourcing</div>
          <div class="sc-input-row">
            <label>单价 Unit Price (\u00a5 CNY)</label>
            <input type="number" id="sc-unit-price" value="${detectedPrice || ''}" step="0.01" placeholder="15.00">
          </div>
          <div class="sc-input-row">
            <label>采购量 Quantity</label>
            <input type="number" id="sc-quantity" value="100" min="1">
          </div>
          <div class="sc-input-row">
            <label>单件重量 Weight/Unit (kg)</label>
            <input type="number" id="sc-weight" value="0.3" step="0.01" min="0.01">
          </div>
        </div>

        <div class="sc-section">
          <div class="sc-section-title">销售 Selling</div>
          <div class="sc-input-row">
            <label>售价 Selling Price ($ USD)</label>
            <input type="number" id="sc-selling-price" value="" step="0.01" placeholder="19.99">
          </div>
          <div class="sc-input-row">
            <label>目标市场 Target Market</label>
            <select id="sc-market">
              ${Object.entries(SHIPPING_RATES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}
            </select>
          </div>
          <div class="sc-input-row">
            <label>平台 Platform</label>
            <select id="sc-platform">
              ${Object.entries(PLATFORMS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}
            </select>
          </div>
          <div class="sc-input-row">
            <label>物流方式 Shipping</label>
            <select id="sc-shipping">
              <option value="sea">海运 Sea (慢/便宜)</option>
              <option value="air">空运 Air (快/贵)</option>
            </select>
          </div>
        </div>

        <button class="sc-btn" id="sc-calculate">计算利润 Calculate</button>

        <div id="sc-results" style="display:none;">
          <div class="sc-divider"></div>
          <div class="sc-section">
            <div class="sc-section-title">成本明细 Cost Breakdown</div>
            <div class="sc-row"><label>采购成本 Sourcing</label><span class="sc-value" id="sc-r-sourcing">-</span></div>
            <div class="sc-row"><label>运费 Shipping</label><span class="sc-value" id="sc-r-shipping">-</span></div>
            <div class="sc-row"><label>关税 Duty (~8%)</label><span class="sc-value" id="sc-r-duty">-</span></div>
            <div class="sc-row"><label>平台佣金 Platform</label><span class="sc-value" id="sc-r-platform">-</span></div>
            <div class="sc-row"><label>FBA 费用</label><span class="sc-value" id="sc-r-fba">-</span></div>
            <div class="sc-divider"></div>
            <div class="sc-row"><label><strong>总成本 Total</strong></label><span class="sc-value" id="sc-r-total"><strong>-</strong></span></div>
          </div>
          <div id="sc-profit-container"></div>
        </div>

        <div style="margin-top:12px;text-align:center;font-size:10px;color:#bbb;">
          汇率 Rate: 1 CNY = $${exchangeRate.toFixed(4)} USD
          <br>SourceCalc v0.1 | Beta
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    // Toggle button (visible when panel is collapsed)
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'sc-toggle-btn';
    toggleBtn.id = 'sc-toggle';
    toggleBtn.textContent = 'SC';
    toggleBtn.title = 'SourceCalc - 利润计算器';
    toggleBtn.style.display = 'none';
    document.body.appendChild(toggleBtn);

    // Events
    document.getElementById('sc-close').addEventListener('click', () => {
      panel.classList.add('sc-collapsed');
      toggleBtn.style.display = 'block';
    });

    toggleBtn.addEventListener('click', () => {
      panel.classList.remove('sc-collapsed');
      toggleBtn.style.display = 'none';
    });

    document.getElementById('sc-calculate').addEventListener('click', runCalculation);

    // Auto-calculate when inputs change
    panel.querySelectorAll('input, select').forEach(input => {
      input.addEventListener('change', () => {
        if (document.getElementById('sc-selling-price').value) runCalculation();
      });
    });

    // Also auto-calculate on Enter key in selling price
    document.getElementById('sc-selling-price').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runCalculation();
    });
  }

  function runCalculation() {
    const unitPrice = parseFloat(document.getElementById('sc-unit-price').value);
    const quantity = parseInt(document.getElementById('sc-quantity').value) || 100;
    const weight = parseFloat(document.getElementById('sc-weight').value) || 0.3;
    const sellingPrice = parseFloat(document.getElementById('sc-selling-price').value);
    const market = document.getElementById('sc-market').value;
    const platform = document.getElementById('sc-platform').value;
    const shipping = document.getElementById('sc-shipping').value;

    if (!unitPrice || !sellingPrice) return;

    const result = calculate({
      unitPriceCNY: unitPrice,
      quantity,
      weightKg: weight,
      sellingPriceUSD: sellingPrice,
      market,
      platform,
      shippingMethod: shipping,
    });

    document.getElementById('sc-r-sourcing').textContent = `$${result.sourcingCostUSD}`;
    document.getElementById('sc-r-shipping').textContent = `$${result.shippingPerUnit}`;
    document.getElementById('sc-r-duty').textContent = `$${result.customsDuty}`;
    document.getElementById('sc-r-platform').textContent = `$${result.platformReferral}`;
    document.getElementById('sc-r-fba').textContent = `$${result.fbaFee}`;
    document.getElementById('sc-r-total').innerHTML = `<strong>$${result.totalCost}</strong>`;

    const isLoss = parseFloat(result.profit) < 0;
    document.getElementById('sc-profit-container').innerHTML = `
      <div class="sc-profit-box ${isLoss ? 'sc-loss' : ''}">
        <div class="sc-profit-amount">${isLoss ? '-' : '+'}$${Math.abs(parseFloat(result.profit)).toFixed(2)}</div>
        <div class="sc-profit-label">${isLoss ? '亏损' : '利润'} / unit</div>
      </div>
      <div class="sc-metrics">
        <div class="sc-metric">
          <div class="sc-metric-value">${result.margin}%</div>
          <div class="sc-metric-label">利润率 Margin</div>
        </div>
        <div class="sc-metric">
          <div class="sc-metric-value">${result.roi}%</div>
          <div class="sc-metric-label">ROI</div>
        </div>
        <div class="sc-metric">
          <div class="sc-metric-value">$${result.totalInvestment}</div>
          <div class="sc-metric-label">总投入 Investment</div>
        </div>
        <div class="sc-metric">
          <div class="sc-metric-value">$${result.totalProfit}</div>
          <div class="sc-metric-label">总利润 Profit</div>
        </div>
      </div>
    `;

    document.getElementById('sc-results').style.display = 'block';

    // Save settings
    chrome.storage.local.set({ lastMarket: market, lastPlatform: platform, lastShipping: shipping, lastWeight: weight, lastQuantity: quantity });
  }

  function init() {
    // Check if this looks like a product page
    const url = window.location.href;
    const isProductPage = url.includes('offer') || url.includes('detail') || url.includes('/p/');

    if (!isProductPage) {
      // Still try — 1688 uses SPAs, URL patterns may differ
      const hasPrice = extractProductPrice();
      if (!hasPrice) return;
    }

    chrome.storage.local.get(['lastMarket', 'lastPlatform', 'lastShipping', 'lastWeight', 'lastQuantity'], (data) => {
      createPanel();
      if (data.lastMarket) document.getElementById('sc-market').value = data.lastMarket;
      if (data.lastPlatform) document.getElementById('sc-platform').value = data.lastPlatform;
      if (data.lastShipping) document.getElementById('sc-shipping').value = data.lastShipping;
      if (data.lastWeight) document.getElementById('sc-weight').value = data.lastWeight;
      if (data.lastQuantity) document.getElementById('sc-quantity').value = data.lastQuantity;
    });
  }

  // Initialize with retry (1688 uses heavy JS rendering)
  function tryInit(attempts) {
    if (attempts <= 0) return;
    if (document.getElementById('sourcecalc-panel')) return;

    init();

    // If panel wasn't created, retry
    if (!document.getElementById('sourcecalc-panel') && attempts > 1) {
      setTimeout(() => tryInit(attempts - 1), 2000);
    }
  }

  // Start after page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => tryInit(5), 1500));
  } else {
    setTimeout(() => tryInit(5), 1500);
  }

  // Also watch for SPA navigation (1688 is a SPA)
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      // Remove old panel
      const old = document.getElementById('sourcecalc-panel');
      if (old) old.remove();
      const oldToggle = document.getElementById('sc-toggle');
      if (oldToggle) oldToggle.remove();
      // Re-initialize
      setTimeout(() => tryInit(5), 2000);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
