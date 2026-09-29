/* View E — the impact score, as a distribution.
 *
 * Everywhere else the interface reports a rate, a difference or a mean. A mean is a
 * summary that assumes a shape, and this variable does not have the shape a mean
 * assumes: over the coded incidents it is a single hump between 5 and 9, and over the
 * whole corpus it is bimodal, because 42% of the incidents have no coded impact at all.
 *
 * Those uncoded incidents are not drawn. They are not a low score: measured, of the
 * 1,428 incidents scoring zero, 100% have both the functional and the intelligence
 * impact field marked "not available" - nobody filled the field in. A bar for them on
 * the same axis would turn a gap in the codebook into a finding about cyber conflict,
 * which is the trap insight 2 documents. What is drawn instead is how many of the
 * selection were coded at all, in words, above the chart - and when none of them were,
 * the card says so rather than showing an empty axis.
 *
 * So the card answers one question - how severe are the incidents in this selection,
 * and how much of that answer exists - and it answers it by gesture: brush the early
 * years and there is nothing to draw; brush 2024 and the hump is all there.
 *
 * It computes nothing and publishes nothing: it tallies incidents the store has already
 * resolved, so no analytic can start here.
 */

"use strict";

const ViewE = (() => {
  const MARGIN = { top: 16, right: 8, bottom: 30, left: 30 };
  const MIN_SCORE = 1;
  const MAX_SCORE = 15;
  const CODED = "#3f3b78";     // the application's indigo

  let corpus = [];

  /** Counts per score, 1 to 15, and how much of the group had a score at all. */
  function tally(incidents) {
    const rows = incidents || [];
    const counts = new Array(MAX_SCORE - MIN_SCORE + 1).fill(0);
    let coded = 0;
    for (const incident of rows) {
      const score = incident.impact_indicator_score;
      if (score == null) continue;
      const value = Math.round(score);
      if (value < MIN_SCORE) continue;      // 0 means "not coded", never "no impact"
      counts[Math.min(MAX_SCORE, value) - MIN_SCORE] += 1;
      coded += 1;
    }
    return { counts, coded, total: rows.length };
  }

  const count = (value) => value.toLocaleString("en-US");

  function draw(data) {
    const host = d3.select("#view-e-canvas");
    host.html("");

    // A legitimate state, not a failure: brush 2000-2013 and no incident in the window
    // has a coded impact. Saying it is the finding; an empty axis would look like a bug.
    if (!data.coded) {
      const why = data.total
        ? `none of the ${count(data.total)} selected incidents has a coded impact`
        : "no impact score in this payload";
      host.html(`<span class="placeholder">${why}</span>`);
      return;
    }

    const width = host.node().clientWidth;
    const height = host.node().clientHeight;
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = height - MARGIN.top - MARGIN.bottom;

    const band = innerW / data.counts.length;
    const barW = Math.max(2, band - 2);
    const max = d3.max(data.counts) || 1;
    const y = d3.scaleLinear().domain([0, max]).range([innerH, 0]).nice();

    const svg = host.append("svg").attr("width", width).attr("height", height)
      .attr("role", "img").attr("aria-label", "Distribution of the impact score");
    const plot = svg.append("g")
      .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    plot.append("g").attr("class", "axis")
      .call(d3.axisLeft(y).ticks(3).tickFormat(d3.format(",d")));

    // How much of the selection this chart is actually about. In the card's header it
    // would be truncated at this width, so it is stated on the chart, where it fits.
    plot.append("text").attr("class", "score-note")
      .attr("x", innerW).attr("y", -5).attr("text-anchor", "end")
      .text(`${count(data.coded)} of ${count(data.total)} coded`);

    const bars = plot.selectAll("g.score").data(data.counts.map((n, i) => ({
      score: i + MIN_SCORE, count: n, share: n / data.coded,
    }))).join("g").attr("class", "score");

    bars.append("rect")
      .attr("x", (d) => (d.score - MIN_SCORE) * band).attr("width", barW)
      .attr("y", (d) => y(d.count)).attr("height", (d) => innerH - y(d.count))
      .attr("fill", CODED);

    // A mark on every score, a number on every third: fifteen numbers in a card this
    // narrow would collide, but without the marks the bars between two numbers have no
    // value to be read against.
    const axisY = innerH + 0.5;
    bars.append("line").attr("class", "score-mark")
      .attr("x1", (d) => (d.score - MIN_SCORE) * band + barW / 2)
      .attr("x2", (d) => (d.score - MIN_SCORE) * band + barW / 2)
      .attr("y1", axisY).attr("y2", axisY + 3);
    plot.append("line").attr("class", "score-mark")
      .attr("x1", 0).attr("x2", innerW).attr("y1", axisY).attr("y2", axisY);

    bars.filter((d) => d.score % 3 === 0).append("text")
      .attr("class", "score-tick")
      .attr("x", (d) => (d.score - MIN_SCORE) * band + barW / 2).attr("y", innerH + 12)
      .text((d) => d.score);

    plot.append("text").attr("class", "score-note")
      .attr("x", innerW).attr("y", innerH + 24).attr("text-anchor", "end")
      .text("impact score");

    const hit = bars.append("rect").attr("class", "row-hit")
      .attr("x", (d) => (d.score - MIN_SCORE) * band - 1).attr("width", barW + 2)
      .attr("y", 0).attr("height", innerH);
    Tooltip.attach(hit, "view-e", (d) =>
      `<span>impact score ${d.score}</span>`
      + `<span>${count(d.count)} incidents (${(d.share * 100).toFixed(1)}% of coded)</span>`);
  }

  function init(incidents) {
    corpus = incidents || [];
    draw(tally(corpus));
  }

  /** Redraw on the shared selection. A tally, not a computation. */
  function applySelection(snapshot) {
    draw(tally((!snapshot || snapshot.empty) ? corpus : snapshot.selected));
  }

  return { init, applySelection };
})();
