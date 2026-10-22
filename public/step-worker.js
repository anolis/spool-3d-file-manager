importScripts('/occt/occt-import-js.js');
let engine;
self.onmessage = async ({ data }) => {
  try {
    engine ||= self.occtimportjs({ locateFile: file => '/occt/' + file });
    const occt = await engine;
    const result = occt.ReadStepFile(new Uint8Array(data), { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.002, angularDeflection: 0.5 });
    if (!result.success || !result.meshes.length) throw new Error('This STEP file could not be converted into a preview.');
    self.postMessage({ meshes: result.meshes });
  } catch (error) { self.postMessage({ error: error.message }); }
};
