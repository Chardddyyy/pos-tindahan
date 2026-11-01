/* Calendar & Monthly/Daily Earnings Overview */
(function () {
  'use strict';

  const { $, api, peso, esc, toast, Sound } = POS;

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const DAY_NAMES = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
  ];

  const el = {
    prevMonthBtn: $('#cal-prev-month'),
    nextMonthBtn: $('#cal-next-month'),
    thisMonthBtn: $('#cal-this-month'),
    monthTitle: $('#cal-month-title'),

    // Month KPI tiles
    monthSales: $('#cal-month-sales'),
    monthSalesSub: $('#cal-month-sales-sub'),
    monthProfit: $('#cal-month-profit'),
    monthProfitSub: $('#cal-month-profit-sub'),
    monthCost: $('#cal-month-cost'),
    monthOrders: $('#cal-month-orders'),
    monthUnits: $('#cal-month-units'),

    // Grid
    daysGrid: $('#cal-days-grid'),

    // Day Detail Card
    dayTitle: $('#cal-day-title'),
    daySubtitle: $('#cal-day-subtitle'),
    dayReportLink: $('#cal-day-report-link'),
    daySales: $('#cal-day-sales'),
    dayProfit: $('#cal-day-profit'),
    dayCount: $('#cal-day-count'),
    dayUnits: $('#cal-day-units'),
    dayEmpty: $('#cal-day-empty'),
    dayItems: $('#cal-day-items'),
  };

  let todayStr = new Date().toISOString().slice(0, 10);
  let currentMonthStr = todayStr.slice(0, 7); // 'YYYY-MM'
  let viewingMonthStr = currentMonthStr;
  let selectedDateStr = todayStr;
  let monthSummaryData = null;

  function formatDayLong(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const dayName = DAY_NAMES[dateObj.getDay()];
    const monthName = MONTH_NAMES[dateObj.getMonth()];
    return `${dayName}, ${monthName} ${d}, ${y}`;
  }

  // ---------- Load Month Summary ----------
  async function loadMonth(ym) {
    if (ym > currentMonthStr) {
      toast('Future months cannot be accessed.', 'warn');
      return;
    }

    try {
      const res = await api.get('/api/calendar/month?month=' + encodeURIComponent(ym));
      viewingMonthStr = res.month;
      todayStr = res.today;
      currentMonthStr = res.current_month;
      monthSummaryData = res.summary;

      renderMonthHeader();
      renderMonthKPIs(res.summary);
      renderGrid();

      // If selected date is in this month, show it, otherwise select 1st or today
      if (selectedDateStr.startsWith(viewingMonthStr)) {
        loadDayDetail(selectedDateStr);
      } else if (viewingMonthStr === currentMonthStr) {
        selectedDateStr = todayStr;
        loadDayDetail(selectedDateStr);
      } else {
        selectedDateStr = `${viewingMonthStr}-01`;
        loadDayDetail(selectedDateStr);
      }
    } catch (e) {
      toast('Failed to load calendar: ' + e.message, 'error');
    }
  }

  function renderMonthHeader() {
    const [year, month] = viewingMonthStr.split('-').map(Number);
    el.monthTitle.textContent = `${MONTH_NAMES[month - 1]} ${year}`;

    // Block next month if currently viewing current month
    const isAtCurrentMonth = viewingMonthStr >= currentMonthStr;
    el.nextMonthBtn.disabled = isAtCurrentMonth;
    if (isAtCurrentMonth) {
      el.nextMonthBtn.title = 'Future months are blocked';
    } else {
      el.nextMonthBtn.removeAttribute('title');
    }
  }

  function renderMonthKPIs(s) {
    if (!s) return;
    el.monthSales.textContent = peso(s.sales_cents);
    el.monthSalesSub.textContent = `Gross revenue for ${el.monthTitle.textContent}`;

    el.monthProfit.textContent = peso(s.profit_cents);
    el.monthProfitSub.textContent = `Net profit after cost of goods`;

    el.monthCost.textContent = peso(s.cost_cents);
    el.monthOrders.textContent = s.sales_count;
    el.monthUnits.textContent = `${s.pieces} units sold`;
  }

  // ---------- Render Interactive Calendar Grid ----------
  function renderGrid() {
    const [year, month] = viewingMonthStr.split('-').map(Number);
    const firstDayIndex = new Date(year, month - 1, 1).getDay(); // 0 is Sunday
    const daysInMonth = new Date(year, month, 0).getDate();
    const daysData = (monthSummaryData && monthSummaryData.days) || {};

    let html = '';

    // Empty cells before day 1
    for (let i = 0; i < firstDayIndex; i++) {
      html += '<div class="cal-cell empty-cell" aria-hidden="true"></div>';
    }

    // Days in current month
    for (let d = 1; d <= daysInMonth; d++) {
      const dayNumStr = String(d).padStart(2, '0');
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${dayNumStr}`;
      const isToday = (dateStr === todayStr);
      const isFuture = (dateStr > todayStr);
      const isSelected = (dateStr === selectedDateStr);
      const data = daysData[dateStr];

      if (isFuture) {
        html += `
          <div class="cal-cell future-day" title="Future date (Blocked)" aria-disabled="true">
            <div class="cal-cell-head">
              <span class="day-num">${d}</span>
              <span class="lock-icon" aria-hidden="true">🔒</span>
            </div>
            <div class="day-blocked-label">Blocked</div>
          </div>
        `;
      } else {
        const hasSales = data && data.sales_cents > 0;
        const salesText = hasSales ? peso(data.sales_cents) : '—';
        const profitText = hasSales ? `+${peso(data.profit_cents)}` : '';

        html += `
          <button type="button" class="cal-cell active-day ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''} ${hasSales ? 'has-sales' : ''}" data-date="${dateStr}">
            <div class="cal-cell-head">
              <span class="day-num">${d}</span>
              ${isToday ? '<span class="today-tag">Today</span>' : ''}
            </div>
            <div class="day-earnings">
              ${hasSales ? `
                <span class="day-sales-badge">${salesText}</span>
                <span class="day-profit-badge">${profitText} profit</span>
              ` : `
                <span class="day-no-sales muted small">No sales</span>
              `}
            </div>
          </button>
        `;
      }
    }

    el.daysGrid.innerHTML = html;
  }

  // ---------- Load Daily Detail ----------
  async function loadDayDetail(dateStr) {
    if (dateStr > todayStr) {
      toast('Future dates cannot be accessed.', 'warn');
      return;
    }

    selectedDateStr = dateStr;
    const isToday = (dateStr === todayStr);

    el.dayTitle.textContent = `📅 Earnings for ${formatDayLong(dateStr)}`;
    el.daySubtitle.textContent = isToday ? 'Transactions and revenue for today' : 'Past sales record';
    el.dayReportLink.href = `/reports?date=${dateStr}`;

    // Highlight selected cell in grid
    document.querySelectorAll('.cal-cell.active-day').forEach((btn) => {
      btn.classList.toggle('is-selected', btn.dataset.date === dateStr);
    });

    try {
      const res = await api.get('/api/calendar/day?date=' + encodeURIComponent(dateStr));
      const s = res.summary;
      el.daySales.textContent = peso(s.sales_cents);
      el.dayProfit.textContent = peso(s.profit_cents);
      el.dayCount.textContent = s.sales_count;
      el.dayUnits.textContent = s.pieces;

      if (!s.top_items || !s.top_items.length) {
        el.dayEmpty.hidden = false;
        el.dayItems.hidden = true;
      } else {
        el.dayEmpty.hidden = true;
        el.dayItems.hidden = false;
        el.dayItems.innerHTML = s.top_items.map((item) => `
          <li class="cal-item-row">
            <span class="cal-item-name"><strong>${esc(item.name)}</strong></span>
            <span class="cal-item-meta muted">${item.qty} pcs · ${peso(item.sales_cents)}</span>
          </li>
        `).join('');
      }
    } catch (e) {
      toast('Failed to load day details: ' + e.message, 'error');
    }
  }

  // ---------- Grid Click Handler ----------
  el.daysGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-date]');
    if (!btn) return;
    const dateStr = btn.dataset.date;
    if (dateStr > todayStr) {
      toast('Future dates are blocked.', 'warn');
      return;
    }
    loadDayDetail(dateStr);
  });

  // ---------- Month Controls Handler ----------
  el.prevMonthBtn.addEventListener('click', () => {
    const [year, month] = viewingMonthStr.split('-').map(Number);
    let prevM = month - 1;
    let prevY = year;
    if (prevM < 1) {
      prevM = 12;
      prevY -= 1;
    }
    const prevYM = `${prevY}-${String(prevM).padStart(2, '0')}`;
    loadMonth(prevYM);
  });

  el.nextMonthBtn.addEventListener('click', () => {
    const [year, month] = viewingMonthStr.split('-').map(Number);
    let nextM = month + 1;
    let nextY = year;
    if (nextM > 12) {
      nextM = 1;
      nextY += 1;
    }
    const nextYM = `${nextY}-${String(nextM).padStart(2, '0')}`;
    if (nextYM > currentMonthStr) {
      toast('Cannot view future months.', 'warn');
      return;
    }
    loadMonth(nextYM);
  });

  el.thisMonthBtn.addEventListener('click', () => {
    selectedDateStr = todayStr;
    loadMonth(currentMonthStr);
  });

  // ---------- Init ----------
  loadMonth(currentMonthStr);
})();
