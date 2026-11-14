// Builds the two panels (narrow, wide) around a page's concept.
// A page gives <template id="hint"> (under the suggestions) and, optionally,
// <template id="composer"> to replace the default composer.
const COMPOSER = `
  <div class="composer">
    <div class="ph">Ask me anything about shellby…</div>
    <div class="bar"><span class="mode">Ask first</span><span class="grow"></span><span>Opus 5.5</span></div>
  </div>`;

function panel(wide) {
  const hint = document.getElementById('hint')?.innerHTML ?? '';
  const composer = document.getElementById('composer')?.innerHTML ?? COMPOSER;
  const el = document.createElement('section');
  el.className = `panel ${wide ? 'wide' : 'narrow'}`;
  el.innerHTML = `
    <div class="feed">
      <div class="crab"></div>
      <h1>What are we building?</h1>
      <p class="sub">Working in <b>~/Documents/GitHub/shellby</b></p>
      <div class="sugs">
        <div class="sug">Tour this project</div>
        <div class="sug">Find a bug worth fixing</div>
        <div class="sug">Write tests for what changed</div>
      </div>
      ${hint}
    </div>
    ${composer}`;
  return el;
}

document.body.append(panel(false), panel(true));
const cap = document.createElement('p');
cap.className = 'cap';
cap.textContent = document.title;
document.body.append(cap);
