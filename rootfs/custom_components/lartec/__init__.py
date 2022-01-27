"""
LarTec component.
"""
from __future__ import annotations

import asyncio
import json
import logging

from homeassistant.components import mqtt
from homeassistant.core import HomeAssistant, Event, State, callback
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
    async def on_events(event: Event) -> None:
        """Forward state changed events to mqtt (except time changed ones)."""
        _LOGGER.info("On state changed events...")
        event_dict = event.as_dict()
        if isinstance(event.data["new_state"], State):
            event_dict["data"]["new_state"] = event.data["new_state"].as_dict()
        if isinstance(event.data["old_state"], State):
            event_dict["data"]["old_state"] = event.data["old_state"].as_dict()
        _LOGGER.info(event_dict)
        try:
            # Gotta use `hass` as first argument.
            # TODO: Figure out why?
            await hass.components.mqtt.async_publish(hass, "lartec/event", json.dumps(event_dict))
        except Exception as err:  # pylint: disable=broad-except
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
    async def set_state(topic: str, payload: str, qos: int) -> None:
        """A new MQTT message has been received."""
        payload_data = json.loads(payload);
        domain = "homeassistant"
        service = payload_data["service"]
        service_data = {}
        blocking = False
        context = None
        limit = None,
        target = {"entity_id": payload_data["entity_id"]}
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
    # Gotta use `hass` as first argument.
    # TODO: Figure out why?
    await hass.components.mqtt.async_subscribe('lartec/setState', set_state)

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
