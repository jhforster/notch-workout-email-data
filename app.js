const WORKOUT_DAY = 3;
const WORKOUT_HOUR = 17;
const WORKOUT_MINUTE = 15;
const REPLY_PREFIX = /^\s*(re|fwd?|fw):/i;

const currencyFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

const integerFormatter = new Intl.NumberFormat("en-US");

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const summaryEl = document.querySelector("#summary");
const chartEl = document.querySelector("#chart");
const leaderboardsEl = document.querySelector("#leaderboards");
const yearStatsEl = document.querySelector("#yearStats");
const recordsEl = document.querySelector("#records");
const recordCountEl = document.querySelector("#recordCount");
const trendSummaryEl = document.querySelector("#trendSummary");
const sortButtons = document.querySelectorAll(".sort-button");

let rawRows = [];
let resizeTimer = null;
let recordsSort = {
  key: "sentAt",
  direction: "desc",
};

init();

async function init() {
  const response = await fetch("data.csv");
  const csv = await response.text();
  rawRows = parseCSV(csv);
  sortButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setRecordsSort(button.dataset.sort);
    });
  });
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 120);
  });
  render();
}

function render() {
  const records = buildRecords(rawRows);
  const stats = summarize(records);

  renderSummary(stats);
  renderTrend(records, stats);
  renderLeaderboards(records);
  renderYearStats(records);
  renderRecords(records);
}

function setRecordsSort(key) {
  if (!key) {
    return;
  }

  recordsSort = {
    key,
    direction:
      recordsSort.key === key && recordsSort.direction === "asc" ? "desc" : "asc",
  };
  renderRecords(buildRecords(rawRows));
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  const indexes = Object.fromEntries(header.map((name, index) => [name, index]));

  return body
    .filter((fields) => fields.length > 1)
    .map((fields) => ({
      date: fields[indexes.Date],
      time: fields[indexes.Time],
      day: fields[indexes["Day of Week"]],
      subject: fields[indexes.Subject],
      isReply: REPLY_PREFIX.test(fields[indexes.Subject] || ""),
    }));
}

function buildRecords(rows) {
  return rows
    .filter((row) => !row.isReply)
    .map((row) => {
      const sentAt = parseLocalDateTime(row.date, row.time);
      const workoutAt = nextWorkoutAfter(sentAt);
      const leadHours = (workoutAt.getTime() - sentAt.getTime()) / 36e5;

      return {
        ...row,
        sentAt,
        workoutAt,
        leadHours,
      };
    })
    .sort((a, b) => a.sentAt - b.sentAt);
}

function parseLocalDateTime(date, time) {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes, seconds = 0] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, seconds);
}

function nextWorkoutAfter(sentAt) {
  const workoutAt = new Date(sentAt);
  workoutAt.setHours(WORKOUT_HOUR, WORKOUT_MINUTE, 0, 0);

  const daysUntilWorkout = (WORKOUT_DAY - workoutAt.getDay() + 7) % 7;
  workoutAt.setDate(workoutAt.getDate() + daysUntilWorkout);

  if (workoutAt < sentAt) {
    workoutAt.setDate(workoutAt.getDate() + 7);
  }

  return workoutAt;
}

function summarize(records) {
  if (!records.length) {
    return null;
  }

  const leadTimes = records.map((record) => record.leadHours).sort((a, b) => a - b);
  const totalLead = leadTimes.reduce((total, lead) => total + lead, 0);
  const average = totalLead / leadTimes.length;
  const middle = Math.floor(leadTimes.length / 2);
  const median =
    leadTimes.length % 2
      ? leadTimes[middle]
      : (leadTimes[middle - 1] + leadTimes[middle]) / 2;
  const noticeRate =
    records.filter((record) => record.leadHours >= 24).length / records.length;

  const mostProactive = records.reduce((best, record) =>
    record.leadHours > best.leadHours ? record : best
  );
  const lastMinute = records.reduce((best, record) =>
    record.leadHours < best.leadHours ? record : best
  );
  const trend = calculateTrend(records);

  return {
    count: records.length,
    average,
    median,
    noticeRate,
    mostProactive,
    lastMinute,
    trend,
  };
}

function calculateTrend(records) {
  const count = records.length;
  const xValues = records.map((_, index) => index);
  const yValues = records.map((record) => record.leadHours);
  const sumX = xValues.reduce((total, value) => total + value, 0);
  const sumY = yValues.reduce((total, value) => total + value, 0);
  const sumXY = xValues.reduce((total, value, index) => total + value * yValues[index], 0);
  const sumXX = xValues.reduce((total, value) => total + value * value, 0);
  const denominator = count * sumXX - sumX * sumX;
  const slope = denominator ? (count * sumXY - sumX * sumY) / denominator : 0;
  const intercept = (sumY - slope * sumX) / count;
  const totalChange = slope * (count - 1);

  return {
    slope,
    intercept,
    totalChange,
    label: trendLabel(totalChange),
  };
}

function trendLabel(totalChange) {
  if (Math.abs(totalChange) < 2) {
    return "no clear change";
  }
  return totalChange > 0 ? "getting earlier" : "getting later";
}

function renderSummary(stats) {
  if (!stats) {
    summaryEl.innerHTML = `<div class="empty-state">No records to analyze.</div>`;
    return;
  }

  const cards = [
    {
      label: "Emails analyzed",
      value: integerFormatter.format(stats.count),
      detailLines: ["Original workout", "emails only"],
    },
    {
      label: "24h+ notice rate",
      value: `${Math.round(stats.noticeRate * 100)}%`,
      detailLines: ["Sent at least 24h", "before workout"],
    },
    {
      label: "Average lead time",
      value: `${formatNumber(stats.average)} hr`,
      detailLines: ["Mean hours before", "workout start"],
    },
    {
      label: "Median lead time",
      value: `${formatNumber(stats.median)} hr`,
      detailLines: ["Middle send timing", "across all emails"],
    },
    {
      label: "Most proactive",
      value: `${formatNumber(stats.mostProactive.leadHours)} hr`,
      detailLines: [formatShortDate(stats.mostProactive.sentAt), stats.mostProactive.subject],
      className: "extreme",
      href: "#early-birds",
    },
    {
      label: "Most last minute",
      value: `${formatNumber(stats.lastMinute.leadHours)} hr`,
      detailLines: [formatShortDate(stats.lastMinute.sentAt), stats.lastMinute.subject],
      className: "last-minute",
      href: "#laggy-legends",
    },
  ];

  summaryEl.innerHTML = cards
    .map((card) => {
      const tag = card.href ? "a" : "article";
      const href = card.href ? ` href="${card.href}"` : "";
      const linkClass = card.href ? " metric-link" : "";

      return `
        <${tag} class="metric-card${linkClass} ${card.className || ""}"${href}>
          <p class="metric-label">${escapeHTML(card.label)}</p>
          <p class="metric-value">${escapeHTML(card.value)}</p>
          <p class="metric-detail">
            ${card.detailLines
              .map((line) => `<span>${escapeHTML(line)}</span>`)
              .join("")}
          </p>
        </${tag}>
      `;
    })
    .join("");
}

function renderTrend(records, stats) {
  if (!records.length || !stats) {
    chartEl.innerHTML = `<div class="empty-state">No records to chart.</div>`;
    trendSummaryEl.textContent = "";
    return;
  }

  const width = Math.max(780, Math.round(chartEl.clientWidth || 1100));
  const height = Math.max(320, Math.round(chartEl.clientHeight || 420));
  const padding = { top: 26, right: 32, bottom: 58, left: 58 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxLead = Math.ceil(Math.max(...records.map((record) => record.leadHours)) / 12) * 12;
  const minLead = 0;
  const yTicks = [0, 12, 24, 36, 48, 60, maxLead].filter(
    (value, index, values) => values.indexOf(value) === index && value <= maxLead
  );

  const xScale = (index) =>
    padding.left + (records.length === 1 ? 0 : (index / (records.length - 1)) * plotWidth);
  const yScale = (leadHours) =>
    padding.top + ((maxLead - leadHours) / (maxLead - minLead || 1)) * plotHeight;
  const path = records
    .map((record, index) => `${index === 0 ? "M" : "L"} ${xScale(index)} ${yScale(record.leadHours)}`)
    .join(" ");
  const trendStart = stats.trend.intercept;
  const trendEnd = stats.trend.intercept + stats.trend.slope * (records.length - 1);

  const first = records[0];
  const last = records[records.length - 1];
  const xLabels = [first, records[Math.floor(records.length / 2)], last];
  const totalChange = stats.trend.totalChange;
  const direction = totalChange >= 0 ? "earlier" : "closer to workout time";
  trendSummaryEl.textContent =
    stats.trend.label === "no clear change"
      ? "Trend line shows the overall trend"
      : `Trend line suggests emails are drifting ${direction}`;

  chartEl.innerHTML = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${yTicks
        .map(
          (tick) => `
            <line x1="${padding.left}" y1="${yScale(tick)}" x2="${width - padding.right}" y2="${yScale(
              tick
            )}" stroke="#e9e9ee" stroke-width="1" />
            <text class="tick-label" x="${padding.left - 12}" y="${yScale(tick) + 4}" text-anchor="end">${tick}</text>
          `
        )
        .join("")}
      <text class="axis-label" x="18" y="${padding.top + plotHeight / 2}" transform="rotate(-90 18 ${
        padding.top + plotHeight / 2
      })" text-anchor="middle">hours before workout</text>
      <path class="lead-line" d="${path}" />
      <line class="trend-line" x1="${xScale(0)}" y1="${yScale(trendStart)}" x2="${xScale(
        records.length - 1
      )}" y2="${yScale(trendEnd)}" />
      ${records
        .map(
          (record, index) => `
            <circle class="point" cx="${xScale(index)}" cy="${yScale(record.leadHours)}" r="4.2" fill="${pointColor(
            record.leadHours
          )}">
              <title>${formatNumber(record.leadHours)} hr · ${record.subject} · ${formatDate(record.sentAt)}</title>
            </circle>
          `
        )
        .join("")}
      ${xLabels
        .map((record) => {
          const index = records.indexOf(record);
          return `<text class="tick-label" x="${xScale(index)}" y="${height - 24}" text-anchor="middle">${formatShortDate(
            record.sentAt
          )}</text>`;
        })
        .join("")}
      <line class="hover-guide" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${
        height - padding.bottom
      }" style="display: none;" aria-hidden="true" />
      <circle class="hover-point" cx="${padding.left}" cy="${padding.top}" r="7" style="display: none;" aria-hidden="true" />
      <rect class="hover-capture" x="${padding.left}" y="${padding.top}" width="${plotWidth}" height="${plotHeight}" />
    </svg>
    <div class="chart-tooltip" hidden></div>
  `;

  setupChartHover(records, { padding, plotWidth, width, height, xScale, yScale });
}

function setupChartHover(records, dimensions) {
  const svg = chartEl.querySelector("svg");
  const capture = chartEl.querySelector(".hover-capture");
  const guide = chartEl.querySelector(".hover-guide");
  const hoverPoint = chartEl.querySelector(".hover-point");
  const tooltip = chartEl.querySelector(".chart-tooltip");

  if (!svg || !capture || !guide || !hoverPoint || !tooltip) {
    return;
  }

  const { padding, plotWidth, height, xScale, yScale } = dimensions;

  const hideTooltip = () => {
    tooltip.hidden = true;
    guide.style.display = "none";
    hoverPoint.style.display = "none";
  };

  const showTooltip = (event) => {
    const svgBox = svg.getBoundingClientRect();
    const chartBox = chartEl.getBoundingClientRect();
    const rawX = event.clientX - svgBox.left;
    const boundedX = Math.min(dimensions.width - padding.right, Math.max(padding.left, rawX));
    const ratio = records.length === 1 ? 0 : (boundedX - padding.left) / plotWidth;
    const index = Math.max(0, Math.min(records.length - 1, Math.round(ratio * (records.length - 1))));
    const record = records[index];
    const x = xScale(index);
    const y = yScale(record.leadHours);
    const visibleX = event.clientX - chartBox.left;
    const visibleY = svgBox.top + y - chartBox.top;

    guide.setAttribute("x1", x);
    guide.setAttribute("x2", x);
    guide.setAttribute("y1", padding.top);
    guide.setAttribute("y2", height - padding.bottom);
    guide.style.display = "";

    hoverPoint.setAttribute("cx", x);
    hoverPoint.setAttribute("cy", y);
    hoverPoint.setAttribute("fill", pointColor(record.leadHours));
    hoverPoint.style.display = "";

    tooltip.hidden = false;
    tooltip.dataset.side = visibleX > chartBox.width - 260 ? "left" : "right";
    tooltip.style.left = `${Math.max(12, Math.min(chartBox.width - 12, visibleX))}px`;
    tooltip.style.top = `${Math.max(18, Math.min(chartBox.height - 18, visibleY))}px`;
    tooltip.innerHTML = `
      <span class="tooltip-value">${escapeHTML(formatNumber(record.leadHours))} hr</span>
      <span class="tooltip-meta">Sent ${escapeHTML(formatDate(record.sentAt))}</span>
      <span class="tooltip-subject">${escapeHTML(record.subject)}</span>
    `;
  };

  capture.addEventListener("pointerenter", showTooltip);
  capture.addEventListener("pointermove", showTooltip);
  capture.addEventListener("pointerleave", hideTooltip);
}

function renderLeaderboards(records) {
  if (!records.length) {
    leaderboardsEl.innerHTML = "";
    return;
  }

  const laggyLegends = records
    .slice()
    .sort((a, b) => a.leadHours - b.leadHours)
    .slice(0, 10);
  const earlyBirds = records
    .slice()
    .sort((a, b) => b.leadHours - a.leadHours)
    .slice(0, 10);

  leaderboardsEl.innerHTML = [
    renderLeaderboardCard({
      id: "laggy-legends",
      className: "laggy",
      title: "Laggy legends",
      subtitle: "Closest calls",
      records: laggyLegends,
    }),
    renderLeaderboardCard({
      id: "early-birds",
      className: "early",
      title: "Early birds",
      subtitle: "Biggest lead times",
      records: earlyBirds,
    }),
  ].join("");
}

function renderLeaderboardCard({ id, className, title, subtitle, records }) {
  return `
    <article id="${id}" class="leaderboard-card ${className}">
      <div class="leaderboard-header">
        <div>
          <p class="eyebrow">Segment leaderboard</p>
          <h2>${escapeHTML(title)}</h2>
        </div>
        <span>${escapeHTML(subtitle)}</span>
      </div>
      <ol class="leaderboard-list">
        ${records
          .map(
            (record, index) => `
              <li class="leaderboard-row">
                <span class="leaderboard-rank">${index + 1}</span>
                <span class="leaderboard-main">
                  <span class="subject-text">${escapeHTML(record.subject)}</span>
                  <span>Sent ${escapeHTML(formatShortDate(record.sentAt))}</span>
                </span>
                <span class="leaderboard-time">${escapeHTML(formatNumber(record.leadHours))} hr</span>
              </li>
            `
          )
          .join("")}
      </ol>
    </article>
  `;
}

function renderYearStats(records) {
  const groups = groupRecordsBySentYear(records);

  if (!groups.length) {
    yearStatsEl.innerHTML = `<tr><td colspan="7">No yearly stats available.</td></tr>`;
    return;
  }

  yearStatsEl.innerHTML = groups
    .map(({ year, records: yearRecords }) => {
      const stats = summarize(yearRecords);

      return `
        <tr>
          <td><span class="year-label">${escapeHTML(year)}</span></td>
          <td>${escapeHTML(integerFormatter.format(stats.count))}</td>
          <td>${escapeHTML(Math.round(stats.noticeRate * 100))}%</td>
          <td>${escapeHTML(formatNumber(stats.average))} hr</td>
          <td>${escapeHTML(formatNumber(stats.median))} hr</td>
          <td>
            <span class="year-extreme">${escapeHTML(formatNumber(stats.mostProactive.leadHours))} hr</span>
            <span class="year-detail">${escapeHTML(formatShortDate(stats.mostProactive.sentAt))}</span>
          </td>
          <td>
            <span class="year-extreme">${escapeHTML(formatNumber(stats.lastMinute.leadHours))} hr</span>
            <span class="year-detail">${escapeHTML(formatShortDate(stats.lastMinute.sentAt))}</span>
          </td>
        </tr>
      `;
    })
    .join("");
}

function groupRecordsBySentYear(records) {
  const groups = new Map();

  records.forEach((record) => {
    const year = record.sentAt.getFullYear();
    const yearRecords = groups.get(year) || [];
    yearRecords.push(record);
    groups.set(year, yearRecords);
  });

  return [...groups.entries()]
    .sort(([yearA], [yearB]) => yearA - yearB)
    .map(([year, yearRecords]) => ({
      year,
      records: yearRecords,
    }));
}

function renderRecords(records) {
  recordCountEl.textContent = `${integerFormatter.format(records.length)} emails`;

  updateSortHeaders();

  recordsEl.innerHTML = sortRecords(records)
    .map(
      (record) => `
        <tr>
          <td>${escapeHTML(formatDate(record.workoutAt))}</td>
          <td>${escapeHTML(formatDate(record.sentAt))}</td>
          <td>${escapeHTML(formatNumber(record.leadHours))} hr</td>
          <td><span class="subject-text">${escapeHTML(record.subject)}</span></td>
        </tr>
      `
    )
    .join("");
}

function sortRecords(records) {
  const sorted = records.slice().sort((a, b) => {
    const comparison = compareRecordValues(a, b, recordsSort.key);
    return recordsSort.direction === "asc" ? comparison : -comparison;
  });

  return sorted;
}

function compareRecordValues(a, b, key) {
  if (key === "subject") {
    return a.subject.localeCompare(b.subject, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  if (key === "leadHours") {
    return a.leadHours - b.leadHours;
  }

  if (key === "workoutAt") {
    return a.workoutAt - b.workoutAt;
  }

  return a.sentAt - b.sentAt;
}

function updateSortHeaders() {
  sortButtons.forEach((button) => {
    const th = button.closest("th");
    const isActive = button.dataset.sort === recordsSort.key;
    const indicator = button.querySelector(".sort-indicator");

    th.setAttribute(
      "aria-sort",
      isActive ? (recordsSort.direction === "asc" ? "ascending" : "descending") : "none"
    );
    button.classList.toggle("is-active", isActive);
    if (indicator) {
      indicator.textContent = isActive
        ? recordsSort.direction === "asc"
          ? "↑"
          : "↓"
        : "";
    }
  });
}

function pointColor(leadHours) {
  if (leadHours < 12) {
    return "#d6422f";
  }
  if (leadHours < 24) {
    return "#fc4c02";
  }
  if (leadHours < 48) {
    return "#2d6f93";
  }
  return "#21814f";
}

function formatNumber(value) {
  return currencyFormatter.format(value);
}

function formatDate(date) {
  return dateFormatter.format(date);
}

function formatShortDate(date) {
  return shortDateFormatter.format(date);
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
