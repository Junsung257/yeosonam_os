'use strict';

function imageSizeDisabled() {
  throw new Error(
    'IMAGE_SIZE_DISABLED: PptxGenJS 4.0.1 does not use this dependency; use the verified media pipeline instead.',
  );
}

module.exports = imageSizeDisabled;
module.exports.default = imageSizeDisabled;
module.exports.imageSize = imageSizeDisabled;
module.exports.imageSizeFromFile = imageSizeDisabled;
module.exports.disableTypes = imageSizeDisabled;
module.exports.setConcurrency = imageSizeDisabled;
