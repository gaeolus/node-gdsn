var select = require('xpath.js')
var xmldom = require('xmldom')
var fs = require('fs')

module.exports = function Gdsn(opts) {

  //if (!(this instanceof Gdsn)) return new Gdsn(opts)
  if (this.console) {
    console.log("Warning: constructor function was called without keyword 'new'")
    return new Gdsn(opts) // constructor was called without 'new' keyword
  }

  this._xmldom_parser = new xmldom.DOMParser()
  this._xmldom_serializer = new xmldom.XMLSerializer()

  opts = opts || {} 
  if (!opts.templatePath) opts.templatePath = __dirname + '/templates/'
  if (!opts.homeDataPoolGln) opts.homeDataPoolGln = '0000000000000'
  console.log("GDSN options:")
  console.log(opts)

  if (!opts.homeDataPoolGln.length || opts.homeDataPoolGln.length !== 13) {
    console.log("Error: invalid home data pool GLN: " + opts.homeDataPoolGln)
    process.exit(1)
  }

  this.handleErr = function (err, cb) {
    if (err) {
      process.nextTick(function () {
        cb(err)
      })
      return true
    }
    return false
  }
  
  this.getXmlStringForDom = function ($dom, cb) {
    var self = this
    process.nextTick(function () {
      try {
        var xml = self._xmldom_serializer.serializeToString($dom)
        cb(null, xml)
      }
      catch (err) {
        self.handleErr(err, cb)
      }
    })
  }

  this.getXmlDomForString = function (xml, cb) {
    var self = this
    process.nextTick(function () {
      try {
        var $dom = self._xmldom_parser.parseFromString(xml, "text/xml")
        cb(null, $dom)
      }
      catch (err) {
        self.handleErr(err, cb)
      }
    })
  }

  this.getXmlDomForFile = function (filename, cb) {
    var self = this
    fs.readFile(filename, 'utf-8', function (err, content) {
      if (self.handleErr(err, cb)) return
      console.log("gdsn.getXmlDomForFile : read " + filename + " (" + Buffer.byteLength(content) + " bytes)")
      self.getXmlDomForString(content, cb)
    })
  }

  this.writeFile = function (filename, content, cb) {
    var self = this
    fs.writeFile(filename, content, function (err) {
      if (self.handleErr(err, cb)) return
      console.log("gdsn.writeFile: " + filename + " (" + Buffer.byteLength(content) + " bytes)")
    })
  }
  
  this.createCinResponse = function ($cin, cb) {
    var self = this;
    process.nextTick(function () {
      try {
        var cinInfo = self.getMessageInfo($cin);
        console.log("gdsn.createCinResponse: cin msg info: ");
        console.log(cinInfo);

        if (cinInfo.type !== 'catalogueItemNotification') {
          self.handleErr(new Error('createCinResponse: message must be of type "catalogueItemNotification" and not: ' + cinInfo.type), cb)
          return
        }

        // check that receiver is the home data pool:
        if (cinInfo.receiver !== opts.homeDataPoolGln) {
          self.handleErr(new Error('createCinResponse: message must be addressed to home data pool GLN ' + opts.homeDataPoolGln), cb)
          return
        }
        
        var respTemplateFilename = opts.templatePath + "GDSNResponse_template.xml"
        self.getXmlDomForFile(respTemplateFilename, function (err, $response) {
          if (self.handleErr(err, cb)) return

          cinInfo.resId = "cin_resp_" + new Date().getTime()
          self.populateResponseTemplate($response, cinInfo)

          var $eANUCCResponse = $response.createElement("gdsn:eANUCCResponse")
          $eANUCCResponse.setAttribute("responseStatus", "ACCEPTED")

          var $sender = $response.createElement("sender")
          $sender.appendChild($response.createTextNode(cinInfo.sender))
          $eANUCCResponse.appendChild($sender)

          var $receiver = $response.createElement("receiver")
          $receiver.appendChild($response.createTextNode(cinInfo.receiver))
          $eANUCCResponse.appendChild($receiver)

          var cinTrxNodes = select($cin, "//*[local-name()='transaction']/entityIdentification")

          var $message = $response.getElementsByTagName("eanucc:message")[0]

          var i, j, $responseNode, $documentReceived
          for (i = 0; i < cinTrxNodes.length; i++) {
            $responseNode = $eANUCCResponse.cloneNode(true)
            $documentReceived = $response.createElement("documentReceived")
            for (j = 0; j < cinTrxNodes[i].childNodes.length; j++) {
              if (cinTrxNodes[i].childNodes[j].nodeType === 1) {
                $documentReceived.appendChild(cinTrxNodes[i].childNodes[j].cloneNode(true))
              }
            }
            $responseNode.appendChild($documentReceived)
            $message.appendChild($responseNode)
          }

          self.getXmlStringForDom($response, cb)
        })
      }
      catch (err) {
        self.handleErr(err, cb)
      }
    })
  }

  this.forwardCinFromOtherDP = function ($cin, cb) {
    var self = this
    process.nextTick(function () {
      try {
        var cinInfo = self.getMessageInfo($cin)

        // check that receiver is the home data pool:
        if (cinInfo.receiver !== opts.homeDataPoolGln) {
          self.handleErr(new Error('forwardCinFromOtherDP: message must be addressed to home data pool GLN ' + opts.homeDataPoolGln), cb)
          return
        }
        // set sender to home data pool
        select($cin, "//*[local-name()='Sender']/*[local-name()='Identifier']")[0].firstChild.data = opts.homeDataPoolGln

        // get data recipient (same for all transactions) and set new receiver gln
        var dataRecipient = select($cin, "//catalogueItem/dataRecipient")[0].firstChild.data
        console.log("gdsn.forwardCinFromOtherDP: dataRecipient GLN: " + dataRecipient)

        if (dataRecipient === opts.homeDataPoolGln) {
          self.handleErr(new Error('forwardCinFromOtherDP: dataRecipient must be a local party, not the data pool'), cb)
          return
        }

        select($cin, "//*[local-name()='Receiver']/*[local-name()='Identifier']")[0].firstChild.data = dataRecipient

        // update InstanceIdentifier and message uniqueCreatorIdentification/gln
        var newId = 'cin_' + Date.now() + '_' + dataRecipient
        select($cin, "//*[local-name()='DocumentIdentification']/*[local-name()='InstanceIdentifier']")[0].firstChild.data = newId
        select($cin, "//*[local-name()='message']/entityIdentification/uniqueCreatorIdentification")[0].firstChild.data = newId
        select($cin, "//*[local-name()='message']/entityIdentification/contentOwner/gln")[0].firstChild.data = opts.homeDataPoolGln

        // generate new CIN xml

        console.log('forwardCinFromOtherDP: newId: ' + newId)

        self.getXmlStringForDom($cin, cb)
      }
      catch (err) {
        self.handleErr(err, cb)
      }
    })
  }

  ///////////////// synchronous functions: //////////////////
  ///////////////// synchronous functions: //////////////////
  ///////////////// synchronous functions: //////////////////

  this.getMessageInfo = function ($msg) {
    var info = {}
    info.sender   = select($msg, "//*[local-name()='Sender']/*[local-name()='Identifier']")[0].firstChild.data
    info.receiver = select($msg, "//*[local-name()='Receiver']/*[local-name()='Identifier']")[0].firstChild.data
    info.id       = select($msg, "//*[local-name()='DocumentIdentification']/*[local-name()='InstanceIdentifier']")[0].firstChild.data
    info.type     = select($msg, "//*[local-name()='DocumentIdentification']/*[local-name()='Type']")[0].firstChild.data
    info.ts       = select($msg, "//*[local-name()='DocumentIdentification']/*[local-name()='CreationDateAndTime']")[0].firstChild.data
    return info
  }
  
  this.getTradeItemElements = function ($msg) {
    var info = {}
    info.ts         = select($msg, "//*[local-name()='DocumentIdentification']/*[local-name()='CreationDateAndTime']")[0].firstChild.data
    info.tradeItems = select($msg, "//*[local-name()='tradeItem']")
    return info
  }
  
  this.getTradeItemInfo = function ($ti) {
    var info = {}
    info.gtin         = select($ti, "//tradeItem/tradeItemIdentification/gtin")[0].firstChild.data
    info.childGtins   = select($ti, "//childTradeItem/tradeItemIdentification/gtin")
    return info
  }
  
  this.populateResponseTemplate = function (dom, args) {
    // since it is our template, we know the literal namespace prefixes
    select(dom, "//sh:Sender/sh:Identifier")[0].firstChild.data = args.receiver
    select(dom, "//sh:Receiver/sh:Identifier")[0].firstChild.data = args.sender
    select(dom, "//sh:DocumentIdentification/sh:InstanceIdentifier")[0].firstChild.data = args.resId
    select(dom, "//sh:DocumentIdentification/sh:CreationDateAndTime")[0].firstChild.data = args.ts
    select(dom, "//sh:Scope/sh:InstanceIdentifier")[0].firstChild.data = args.resId
    select(dom, "//sh:Scope/sh:CorrelationInformation/sh:RequestingDocumentCreationDateTime")[0].firstChild.data = args.ts
    select(dom, "//sh:Scope/sh:CorrelationInformation/sh:RequestingDocumentInstanceIdentifier")[0].firstChild.data = args.id
    select(dom, "//eanucc:message/entityIdentification/uniqueCreatorIdentification")[0].firstChild.data = args.resId
    select(dom, "//eanucc:message/entityIdentification/contentOwner/gln")[0].firstChild.data = args.receiver
  }

  this.messageTypes = [
      {
          name: 'cin_from_local_tp',
          direction: 'inbound',
          description: 'can contain only one publication (item hierarchy)',
          doctype: 'catalogueItemNotification',
          created: 'message timestamp, assume we can use this as trade item timestamp for update trigger',
          sender: 'gln of local DSTP',
          receiver: 'gln of home data pool',
          dataRecipient: 'gln of home data pool',
          infoProvider: 'gln of DSTP (local party)',
          sourceDataPool: 'not present',
          root_gtins: 'array of gtins for each hierarchy root trade item',
          gtins: 'array of gtins for all trade items'
      },
      {
          name: 'cin_from_other_dp',
          direction: 'inbound',
          description: 'can contain many publications (item hierarchies) from a single DSTP, sent via partner SDP',
          doctype: 'catalogueItemNotification',
          created: 'message timestamp, assume we can use this as trade item timestamp for update trigger',
          sender: 'gln of other data pool',
          receiver: 'gln of home data pool',
          dataRecipient: 'gln of DRTP (local subscribing party), assume only 1 per message',
          infoProvider: 'gln of DSTP (remote publishing party), assume only 1 per message',
          sourceDataPool: 'gln of other data pool',
          root_gtins: 'array of gtins for each hierarchy root trade item',
          gtins: 'array of gtins for all trade items'
      },
      {
          name: 'cin_to_local_tp_for_remote_ds',
          direction: 'outbound',
          description: 'can contain many publications (item hierarchies) from a single DSTP',
          doctype: 'catalogueItemNotification',
          created: 'message timestamp, assume we can use this as trade item timestamp for update trigger',
          sender: 'gln of home data pool',
          receiver: 'gln of local party',
          dataRecipient: 'gln of DRTP (local subscribing party), assume only 1 per message',
          infoProvider: 'gln of DSTP (remote publishing party), assume only 1 per message',
          sourceDataPool: 'gln of other data pool',
          root_gtins: 'array of gtins for each hierarchy root trade item',
          gtins: 'array of gtins for all trade items'
      },
      {
          name: 'cin_to_local_tp_for_local_ds',
          direction: 'outbound',
          description: 'can contain only one publication (item hierarchy) from a local DSTP',
          doctype: 'catalogueItemNotification',
          created: 'message timestamp, assume we can use this as trade item timestamp for update trigger',
          sender: 'gln of home data pool',
          receiver: 'gln of local party',
          dataRecipient: 'gln of DRTP (local subscribing party), assume only 1 per message',
          infoProvider: 'gln of DSTP (local publishing party), assume only 1 per message',
          sourceDataPool: 'gln of home data pool',
          root_gtins: 'array of gtins for each hierarchy root trade item',
          gtins: 'array of gtins for all trade items'
      }
  ]
  
}
