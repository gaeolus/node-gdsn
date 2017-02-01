var Gdsn = require('../index.js')
var fs   = require('fs')
var test = require('tap').test

test('cheerioCinInfoFromFile', function (t) {
  t.plan(1)

  var gdsn = new Gdsn({
    homeDataPoolGln: "1100001011285"
    , outbox_dir: __dirname + '/outbox'
  })

  var filename = __dirname + '/gdsn2/cin_from_other_dp.xml'

  fs.readFile(filename, 'utf8', function (err, content) {
    if (err) throw err
    var msg_info = gdsn.get_msg_info(content)
    //console.log('cheerioCinInfoFromFile msg_info: ' + JSON.stringify(msg_info))
    t.ok(true, msg_info)
    t.end()
  })

})
