// Minimal mocha-style test harness (describe / it / done) for running the
// Volt test suite on the Arc runtime. Tests run sequentially; a test either
// takes a `done` callback (socket.io style) or returns a promise.

   

       
             

  
   
   


  
   
   


const suites  = [];
let current    = null;

const TIMEOUT_MS = 4000;

export function describe(name , body   )  {
  current = { name, tests: [] };
  suites.push(current);
  body();
  current = null;
}

export function it(name , fn )  {
  if (!current) {
    throw new Error("it() called outside describe()");
  }
  current.tests.push({ name, fn });
}

export function delay(ms )  {
  return new Promise((resolve) => Arc.setTimeout(resolve, ms));
}

export function expect(actual , expected , label )  {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(label + ": expected " + e + ", got " + a);
  }
}

function runTest(test )  {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err ) => {
      if (settled) return;
      settled = true;
      if (err === undefined || err === null) resolve();
      else reject(err);
    };
    Arc.setTimeout(() => finish(new Error("timed out after " + TIMEOUT_MS + "ms")), TIMEOUT_MS);
    try {
      const fn = test.fn  ;
      if (fn.length >= 1) {
        fn(finish);
      } else {
        const result = fn();
        if (result && typeof (result  ).then === "function") {
          (result  ).then(() => finish(), finish);
        } else {
          finish();
        }
      }
    } catch (err) {
      finish(err);
    }
  });
}

   
   
   
   


export async function run()  {
  let passed = 0;
  const failures  = [];
  for (const suite of suites) {
    Arc.log(suite.name);
    for (const test of suite.tests) {
      try {
        await runTest(test);
        passed++;
        Arc.log("  ok " + test.name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(suite.name + " > " + test.name + ": " + message);
        Arc.log("  FAIL " + test.name + " — " + message);
      }
    }
  }
  return { passed, failed: failures.length, failures };
}
