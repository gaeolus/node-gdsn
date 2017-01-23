var cheerio   = require('cheerio')

var ConfirmationInfo = module.exports = function (cic_xml, msg_id, trx_id, cmd_id) {

  if (!cic_xml || !cic_xml.length) return this

  this.xml = cic_xml

  var $ = cheerio.load(this.xml, {
    _:0
    , normalizeWhitespace: true
    , xmlMode: true
    , decodeEntities: false
  })

  this.modified_ts = Date.now()
  this.archived_ts = 0

  this.msg_id = msg_id
  this.trx_id = trx_id
  this.cmd_id = cmd_id

  this.doc_id = $('catalogueItemConfirmationIdentification > uniqueCreatorIdentification').text() // 2.8
  if (!this.doc_id) this.doc_id = $('catalogueItemConfirmationIdentification > entityIdentification').text() // 3.1
  
  this.gtin     = $('catalogueItemReference > gtin').text()
  this.provider = $('catalogueItemReference > dataSource').text()

  this.tm               = $('catalogueItemReference > targetMarket > targetMarketCountryCode > countryISOCode').text() // 2.8
  if (!this.tm) this.tm = $('catalogueItemReference > targetMarketCountryCode').text() // 3.1

  this.tm_sub                   = $('catalogueItemReference   countrySubDivisionISOCode')  .text() // 2.8
  if (!this.tm_sub) this.tm_sub = $('catalogueItemReference > targetMarketSubdivisionCode').text() // 3.1
  if (!this.tm_sub) this.tm_sub = 'na'
 
  this.state                  = $('catalogueItemConfirmationState'    ).attr('state') // 2.8
  if (!this.state) this.state = $('catalogueItemConfirmationStateCode').text()        // 3.1

  this.recipient    = $('catalogueItemConfirmationState > recipientGLN').text()
  this.recipient_dp = $('catalogueItemConfirmationState > recipientDataPool').text()

  var self = this
  // custom cic values:
  $('catalogueItemConfirmationStatusDetail > catalogueItemConfirmationStatus').first().each(function () {
    self.confirm_code = $('confirmationStatusCode'                          , this).text() || ''
    self.confirm_desc = $('confirmationStatusCodeDescription'               , this).text() || ''
    self.confirm_long = $('additionalConfirmationStatusLongDescription'     , this).text() || ''
    self.confirm_cac  = $('correctiveAction > correctiveActionCode'         , this).text() || ''
    self.confirm_eci  = $('correctiveAction > expectedCorrectiveInformation', this).text() || ''
  })

  var note = ''
  $('catalogueItemConfirmationStatusDetail').each(function () {
    // catch-all for other details that may be present per xsd
    var text = $(this).text()
    if (text) note += text  + ' '
  })
  if (note) {
    if (this.note) this.note_orig = this.note
    this.note = note
  }

  if (!this.confirm_code) this.confirm_code = ''
  if (!this.confirm_desc) this.confirm_desc = ''
  if (!this.confirm_long) this.confirm_long = ''
  if (!this.confirm_cac) this.confirm_cac = ''
  if (!this.confirm_eci) this.confirm_eci = ''

  // CIC variations: TP-DP . DP-ODP | ODP-DP . DP-TP
  // -----------------------------------------------
  // Sender           278  .  285   |  xyz   .  285
  // Receiver         285  .  ???   |  285   .  292
  // Recipient        278  .  278   |  abc   .  abc
  // Recipient_DP     285  .  285   |  xyz   .  xyz
  // Source           abc  .  abc   |  292   .  292
  // Source_DP        ???  .  ???   |  285   .  285

  // ??? needs item lookup to resolve proper source_dp/msg receiver


  // CIC variations: Sender Receiver Recipient Recipient_DP Source Source_DP
  // -----------------------------------------------------------------------
  // TP-DP            278     285      278       285          abc     xyz
  // DP-ODP           285     xyz      278       285          abc     xyz
  // -----
  // ODP-DP           xyz     285      abc       xyz          292     285
  // DP-TP            285     292      abc       xyz          292     285
  // -----
  // Private/TBD (not supported now):
  // TP-DP            278     285      278       285          292     285
  // DP-TP            285     292      278       285          292     285


  //console.log('new cic info: ' + JSON.stringify(this));
  return this
}
