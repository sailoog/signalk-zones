"use strict"

module.exports = function (app) {

  const debug = app.debug || (msg => { console.log(msg) })
  var plugin = {}
  var unsubscribes = []

  plugin.id = "zones-edit"
  plugin.name = "Edit Zones"
  plugin.description = "Plugin to configure path zones and zone notification states."

  plugin.schema = {
    "description": "Zones provide a series of hints to the consumer. These hints help in properly setting a range of colors on display gauges. This visual indication helps identify normal or dangerous operating conditions. Additionally, Zones emit data state notification messages.",
    type: "object",
    properties: {
      zones: {
        type: "array",
        title: " ",
        items: {
          title: "Signal K Path",
          type: "object",
          "required": [
            "key"
          ],
          properties: {
            "active": {
              title: "Active",
              type: "boolean",
              default: true
            },
            "key": {
              title: "Path",
              type: "string",
              default: "",
            },
            "zones": {
              "type": "array",
              "minItems": 1,
              "title": "Zones",
              "description": "Each Signal K Path can define multiple Zones. If the value of a Path does not fall within one of its Zones, the default Zone, 'normal', is used. It's possible for multiple zones to share the same state, but have different ranges.",
              "items": {
                "type": "object",
                "title": "Zone",
                "required": ["state"],
                "properties": {
                  "lower": {
                    "id": "lower",
                    "type": "number",
                    "title": "Lower",
                    "description": "The lowest value in this zone, based on its default unit,",
                    "name": "lower"
                  },

                  "upper": {
                    "id": "upper",
                    "type": "number",
                    "title": "Upper",
                    "description": "The highest value in this zone, based on its default unit.",
                    "name": "upper"
                  },

                  "state": {
                    "type": "string",
                    "title": "State",
                    "description": "The state when the value is in this zone.",
                    "default": "normal",
                    "enum": ["nominal", "normal", "alert", "warn", "alarm", "emergency"]
                  },

                  "method": {
                    "description": "Notification options to use when the value is in this zone.",
                    "type": "array",
                    "maxItems": 2,
                    "items": {
                      "type": "string",
                      "enum": ["visual", "sound"]
                    },
                    default: ["visual", "sound"]
                  },

                  "message": {
                    "id": "message",
                    "type": "string",
                    "title": "Message",
                    "description": "Custom message to display for the notification. If not set, a default message containing 'zone.lower < value < zone.upper' will be generated.",
                    "default": ""
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  plugin.start = function (options) {
    debug('Starting zones plugin with options:', options)
    if (options.zones && options.zones.length) {
      sendZonesMetaDeltas(options.zones)
    }
    unsubscribes = (options.zones || []).reduce((acc, {
      key,
      active,
      zones,
    }) => {
      if (active) {
        var stream = app.streambundle.getSelfStream(key)
        const tests = zones.map((zone, i) => {
          if (typeof zone.upper != 'undefined') {
            if (typeof zone.lower != 'undefined') {
              return value => value < zone.upper && value >= zone.lower
            } else {
              return value => value < zone.upper
            }
          } else {
            return value => value > zone.lower
          }
        })
        acc.push(stream.map(value => {
          const zoneIndex = tests.findIndex(test => test(value));
          debug(`Value: ${value}, Zone Index: ${zoneIndex}`);
          return zoneIndex;
        }).skipDuplicates().onValue(zoneIndex => {
          debug(`Sending notification for key: ${key}, Zone Index: ${zoneIndex}`);
          sendNotificationUpdate(key, zoneIndex, zones)
        }))
      }
      return acc
    }, [])
    return true
  }

  plugin.stop = function () {
    unsubscribes.forEach(f => f())
    unsubscribes = []
  }

  function sendNotificationUpdate(key, zoneIndex, zones) {
    var value = null
    if (zoneIndex >= 0) {
      const zone = zones[zoneIndex]
      value = {
        state: zone.state,
        message: zone.message || zone.lower + ' < value < ' + zone.upper,
        method: zone.method
      }
    } else {
      // Default to "normal" zone
      value = {
        state: "normal",
        message: "Value is within normal range",
        method: [],
      }
    }
    const notificationDelta = {
      context: "vessels." + app.selfId,
      updates: [
        {
          source: {
            label: "self.notificationhandler"
          },
          values: [{
            path: "notifications." + key,
            value: value
          }]
        }
      ]
    }
    debug('Sending path zones notification:', JSON.stringify(notificationDelta))
    app.handleMessage(plugin.id, notificationDelta)
  }

  function sendZonesMetaDeltas(zoneEntries) {
    const metaDelta = {
      context: "vessels." + app.selfId,
      updates:
        zoneEntries.map(zoneEntry => ({
          source: {
            label: "self.notificationhandler"
          },
          meta: [
            {
              path: zoneEntry.key,
              value: {
                zones: zoneEntry.zones.map(z => ({
                  state: z.state,
                  lower: z.lower,
                  upper: z.upper,
                  message: z.message
                })),
                nominalMethod: (zoneEntry.zones.find(z => z.state === 'nominal') || {}).method,
                normalMethod: (zoneEntry.zones.find(z => z.state === 'normal') || {}).method,
                alertMethod: (zoneEntry.zones.find(z => z.state === 'alert') || {}).method,
                warnMethod: (zoneEntry.zones.find(z => z.state === 'warn') || {}).method,
                alarmMethod: (zoneEntry.zones.find(z => z.state === 'alarm') || {}).method,
                emergencyMethod: (zoneEntry.zones.find(z => z.state === 'emergency') || {}).method,
              }
            }
          ]
        })
        )
    }
    debug('Sending path metadata configuration:', JSON.stringify(metaDelta))
    app.handleMessage(plugin.id, metaDelta)
  }

  return plugin
}
