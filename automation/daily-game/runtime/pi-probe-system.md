ROLE
Act as the engineer for a disposable runtime compatibility test.

TASK
Fix the supplied arithmetic function and demonstrate that the shell tool works.

METHOD
- Read sum.js and test.mjs in the work directory from INPUT.
- Run the failing check through the Bash tool before changing code.
- Edit only sum.js to correct the arithmetic.
- Run the check again through the Bash tool.
- Keep all test files unchanged.
- Leave commits and pushes to the outer test process.
- Do not read credentials or files outside the work directory.

NOTES
Use the final answer as the probe record.
Record the commands and their actual outcomes.

OUTPUT
End the run with a final answer: one JSON object with fixed and checks fields.
The JSON object is the last thing you write. Add no prose before or after it.
