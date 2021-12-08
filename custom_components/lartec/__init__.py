"""
LarTec component.
"""
from __future__ import annotations

import asyncio
import json
import logging

from homeassistant.components import mqtt
from homeassistant.core import HomeAssistant, Event, callback
from homeassistant.helpers.typing import ConfigType
from homeassistant.const import EVENT_TIME_CHANGED, EVENT_STATE_CHANGED, MATCH_ALL

# The domain of your component. Should be equal to the name of your component.
DOMAIN = "lartec"

_LOGGER = logging.getLogger(__name__)

#
# ON EVENTS
#
async def on_events(hass: HomeAssistant) -> None:
    @callback
    # def forward_event(event: Event) -> None:
    #     """Forward events to mqtt (except time changed ones)."""
    #     if event.event_type == EVENT_TIME_CHANGED:
    #         return

    #     if event.domain == "mqtt":
    #         return
    #     hass.components.mqtt.async_publish("lartec/event", event)

    # All events
    # hass.bus.async_listen(MATCH_ALL, forward_event)

    # State changed events only
    def on_events(event: Event) -> None:
        """Forward state changed events to mqtt (except time changed ones)."""
        event_dict = event.as_dict()
        _LOGGER.info(event_dict)
        _LOGGER.info(event.data.new_state.as_dict())
        event_dict["data"]["new_state"] = event.data.new_state.as_dict()
        event_dict["data"]["old_state"] = event.data.old_state.as_dict()
        _LOGGER.info(event_dict)
        try:
            hass.components.mqtt.async_publish("lartec/event", json.dumps(event_dict))
        except Exception as err:  # pylint: disable=broad-except
            _LOGGER.exception(event_dict)
            _LOGGER.exception(err)
    hass.bus.async_listen(EVENT_STATE_CHANGED, on_events)

#
# 
#
async def remote_set_state(hass: HomeAssistant) -> None:
    # Remote setState
    # TODO
    # hass.states.async_set(entity_id, payload)
    # hass.bus.fire("example_component_my_cool_event", {"answer": 42})
    #
    # await hass.components.mqtt.async_subscribe('lartec/setState', message_received)

    @callback
    async def async_set_state(topic: str, payload: str, qos: int) -> None:
        """A new MQTT message has been received."""
        domain = "homeassistant"
        service = "turn_on"
        # service_data = {"entity_id": "switch.0xb4e3f9fffef96753"}
        service_data = {}
        blocking = False
        context = None
        limit = None,
        # target = None
        target = {"entity_id": "switch.0xb4e3f9fffef96753"}
        try:
            await hass.services.async_call(
                domain,
                service,
                service_data,
                blocking,
                context,
                limit,
                target,
            )
        except Exception as err:  # pylint: disable=broad-except
            _LOGGER.exception(err)
    await hass.components.mqtt.async_subscribe('lartec/setState', async_set_state)

#
# 
#
async def remote_set_configure(hass: HomeAssistant) -> None:
    return True

#
# 
#
async def remote_software_update(hass: HomeAssistant) -> None:
    # Remote add new device
    # curl -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" -H "Content-Type: application/json" http://supervisor/host/reboot

    # Return boolean to indicate that initialization was successfully.
    return True

#
# SETUP
#
async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Setup our skeleton component."""
    @callback
    def message_received(topic: str, payload: str, qos: int) -> None:
        """A new MQTT message has been received."""
        hass.components.mqtt.async_publish("lartec/foo", "Works! 4")
    await hass.components.mqtt.async_subscribe('lartec/init', message_received)

    # On events
    await on_events(hass)

    # Remote setState
    await remote_set_state(hass)

    # Remote setConfigure
    await remote_set_configure(hass)

    # Remote softwareUpdate
    await remote_software_update(hass)

    # Return boolean to indicate that initialization was successfully.
    hass.states.async_set('lartec.status', 'OK')
    return True
