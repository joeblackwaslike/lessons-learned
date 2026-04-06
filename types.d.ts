// Ambient declaration to prevent TypeScript from resolving the punycode npm package
// (a transitive dependency of @types/node that has unparseable JS for tsc).
declare module 'punycode' {
  const punycode: any;
  export = punycode;
}
