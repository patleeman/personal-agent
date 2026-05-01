function sharp() {
  throw new Error('The sharp image-processing dependency is not bundled with Personal Agent. Local transcription does not require it.');
}

module.exports = sharp;
module.exports.default = sharp;
