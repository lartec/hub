"""
LarTec component.
"""
from __future__ import annotations

import asyncio

from homeassistant.components import mqtt
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.typing import ConfigType
from homeassistant.const import EVENT_TIME_CHANGED, EVENT_STATE_CHANGED, MATCH_ALL

# The domain of your component. Should be equal to the name of your component.
DOMAIN = "lartec"

async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Setup our skeleton component."""
    @callback
    def message_received(topic: str, payload: str, qos: int) -> None:
        """A new MQTT message has been received."""
        hass.components.mqtt.async_publish("lartec/foo", "Works! 4")
    await hass.components.mqtt.async_subscribe('lartec/init', message_received)

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
        hass.components.mqtt.async_publish("lartec/event", event)
    hass.bus.async_listen(EVENT_STATE_CHANGED, on_events)

    # Return boolean to indicate that initialization was successfully.

    # On events
    # TODO
    hass.states

    # Remote setState
    # TODO

    # Remote setConfigure
    # TODO

    # Remote softwareUpdate
    # TODO

    hass.states.async_set('lartec.status', 'OK')

    return True

async def FOO_BAR_async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Setup our skeleton component."""
    hass.states.async_set('lartec.foo', 'Bar')

    @callback
    def message_received(topic: str, payload: str, qos: int) -> None:
        """A new MQTT message has been received."""
        hass.components.mqtt.async_publish("lartec/foo", "Works! 4")


    #
    # On events
    #
    # @callback
    # def forward_events(event: Event) -> None:
    #     """Forward events to mqtt (except time changed ones)."""

    #     if event.event_type == EVENT_TIME_CHANGED:
    #         return
    #     
    #     hass.components.mqtt.subscribe('lartec/event', event)

    # hass.bus.listen(MATCH_ALL, forward_events)

    @callback
    async def async_forward_events(event: Event) -> None:
        """Forward events to mqtt (except time changed ones)."""

        if event.event_type == EVENT_TIME_CHANGED:
            return
        
        await hass.components.mqtt.async_subscribe('lartec/event', event)

    await hass.bus.async_listen(MATCH_ALL, async_forward_events)

    # Remote setState
    # TODO
    # hass.states.async_set(entity_id, payload)
    # hass.bus.fire("example_component_my_cool_event", {"answer": 42})
    #
    # await hass.components.mqtt.async_subscribe('lartec/setState', message_received)

    # Remote setConfigure
    # TODO

    # Remote softwareUpdate
    # TODO

    # Remote add new device
    # curl -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" -H "Content-Type: application/json" http://supervisor/host/reboot

    # Return boolean to indicate that initialization was successfully.
    return True
