module.exports = {
  default: 'file',
  file: { module: 'localfilesystem' },
  winter: { module: 'localfilesystem', config: { base: 'winter-context', cache: false } }
};
