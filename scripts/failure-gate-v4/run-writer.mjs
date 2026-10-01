#!/usr/bin/env node
import {
  EXTERNAL_WRITER_BOUNDARY,
  getWriterRouteIds,
  runControlledWriter,
} from "./writer-routes.mjs";

async function main(argv) {
  if (argv.length !== 1 || !getWriterRouteIds().includes(argv[0])) {
    console.error(
      `usage: node scripts/failure-gate-v4/run-writer.mjs <${getWriterRouteIds().join("|")}>`,
    );
    console.error("extra arguments and arbitrary commands are refused");
    return 2;
  }
  try {
    console.error(
      `cooperative route only: ${EXTERNAL_WRITER_BOUNDARY.uncoveredWriterClasses.join("; ")} remain unknown; no verified workspace snapshot is claimed`,
    );
    return await runControlledWriter(argv[0]);
  } catch (error) {
    console.error(`controlled writer route denied: ${error.message}`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));