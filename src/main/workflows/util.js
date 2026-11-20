// Small text helpers the workflow service's parts share.

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const clean = s => String(s ?? '').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]+/g, ' ').trim();

// A class's methods copied onto another class: WorkflowService is one object
// whose parts live in files of their own, sharing its state through `this`.
function mixin(target, ...parts) {
  for (const part of parts) {
    for (const name of Object.getOwnPropertyNames(part.prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(part.prototype, name);
      if (name !== 'constructor' && descriptor) Object.defineProperty(target.prototype, name, descriptor);
    }
  }
  return target;
}

module.exports = { same, clean, mixin };
