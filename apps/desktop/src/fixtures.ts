/**
 * Bundled sample files from the repository fixtures directory.
 * Uses ?url imports so binary encodings (UTF-16 etc.) survive; content is
 * fetched and decoded through the core encoding layer on load.
 */

export interface FixtureSample {
  name: string;
  vendor: string;
  url: string;
}

const modules = import.meta.glob(
  "../../../fixtures/**/*.{otd,dat,opt,r01,imp,edi,otv,dxf,cut,cni,xml,json,xyz,pgm,lst,dst,sum,src,iso,OTD,DAT,EDI,DXF,CUT,ISO,PGM,R01,XYZ,DST}",
  {
    query: "?url",
    import: "default",
    eager: true,
  }
) as Record<string, string>;

const VENDOR_BY_DIR: Record<string, string> = {
  bottero: "Bottero",
  bystronic: "Bystronic",
  chaoyang: "Chaoyang",
  disai: "Disai",
  eagle: "Eagle",
  hegla: "Hegla",
  intermac: "Intermac",
  bavelloni: "Bavelloni",
  lampo: "Lampo",
  lisec: "Lisec",
  macotech: "Macotech",
  optima: "Optima",
  perfectcut: "Perfect Cut",
  turomas: "Turomas",
  vetromac: "Vetromac",
  dxf: "DXF",
};

export const fixtureSamples: FixtureSample[] = Object.entries(modules)
  .map(([path, url]) => {
    const m = path.match(/fixtures[/\\]([^/\\]+)[/\\](.*)$/);
    if (!m) return null;
    const dir = m[1].toLowerCase();
    const name = m[2].replace(/[/\\]/g, " / ");
    return {
      name,
      vendor: VENDOR_BY_DIR[dir] ?? dir,
      url,
    };
  })
  .filter((s): s is FixtureSample => s !== null)
  .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
