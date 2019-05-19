$_$wp(1);
const regex = ($_$w(1, 0), /\${(?:([\w-]+):)?([\w-]+)(?:\.([\w-.]+))?(?:[\s]*[,][\s]*["']*([\w-.:]+)["']*)?}/);
const testString = ($_$w(1, 1), 'arn:aws:apigateway:eu-west1:lambda:path/2015-03-31/functions/${webhook-auth.arn}/invocations');
let pos = ($_$w(1, 2), 0);
const currentScope = ($_$w(1, 3), 'resource');
const bits = ($_$w(1, 4), []);
while ($_$w(1, 5), pos < testString.length) {
    $_$w(1, 6), $_$tracer.log('POS', pos, '', 1, 6);
    const varStart = ($_$w(1, 7), testString.indexOf('${', pos));
    if ($_$w(1, 8), varStart !== -1) {
        const varEnd = ($_$w(1, 9), testString.indexOf('}', varStart) + 1);
        if ($_$w(1, 10), varEnd === -1) {
            {
                $_$w(1, 11);
                throw Error('Variable close not found');
            }
        }
        $_$w(1, 12), $_$tracer.log('VARSTART POS', varStart, pos, '', 1, 12);
        if ($_$w(1, 13), varStart > pos) {
            $_$w(1, 14), bits.push(testString.substring(pos, varStart));
        }
        $_$w(1, 15), $_$tracer.log(varStart, varEnd, 'varStart', 1, 15);
        $_$w(1, 16), $_$tracer.log(testString.substring(varStart, varEnd), 'testString.substring(varStart, varEnd)', 1, 16);
        const varParts = ($_$w(1, 17), regex.exec(testString.substr(varStart, varEnd)));
        if ($_$w(1, 18), !varParts) {
            {
                $_$w(1, 19);
                throw Error('Cannot decode variable format');
            }
        }
        $_$w(1, 20), bits.push({
            scope: varParts[1] !== undefined ? ($_$w(1, 21), varParts[1]) : ($_$w(1, 22), currentScope),
            resource: varParts[2],
            bindTo: varParts[3],
            default: varParts[4] !== undefined ? ($_$w(1, 23), varParts[4]) : ($_$w(1, 24), '')
        });
        $_$w(1, 25), pos = varEnd;
    } else if ($_$w(1, 26), pos < testString.length) {
        $_$w(1, 27), bits.push(testString.substring(pos));
        $_$w(1, 28), pos = testString.length;
    }
}
$_$w(1, 29), $_$tracer.log(bits, 'bits', 1, 29);
$_$wpe(1);