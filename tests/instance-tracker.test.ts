import { InstanceTracker } from "../src/instance-tracker";

describe('InstanceTracker', () => {
    let tracker: InstanceTracker;

    beforeEach(() => {
        tracker = new InstanceTracker();
    });

    test('should detect post load events', () => {
        tracker.processLogLine("2023/06/15 12:34:56 123456789 abc [INFO Client 123] Generating level 83 area \"MapBeach\" with seed 12345");
        const eventSpy = jest.fn();
        tracker.eventDispatcher.on("areaPostLoad", eventSpy);
        tracker.processLogLine("2023/06/15 12:34:57 123456789 abc [INFO Client 123] [SHADER] Delay: 123ms");
        expect(eventSpy).toHaveBeenCalled();
    });


    test('should detect mapCompleted event', () => {
        const mapGenerationLine = "2023/06/15 12:34:56 123456789 abc [INFO Client 123] Generating level 83 area \"MapBeach\" with seed 12345";
        const interactionLine = "2023/06/15 12:35:00 123456789 abc [INFO Client 123] : PlayerThree has been slain";
        const hideoutGenerationLine = "2023/06/15 12:35:05 123456789 def [DEBUG Client 456] Generating level 70 area \"HideoutLuxurious\" with seed 1";
        const anotherMapGenerationLine = "2023/06/15 12:35:10 123456789 ghi [INFO Client 789] Generating level 75 area \"MapDesert\" with seed 54321";

        tracker.processLogLine(mapGenerationLine);
        tracker.processLogLine(interactionLine);
        const eventSpy = jest.fn();
        tracker.eventDispatcher.on("mapCompleted", eventSpy);

        tracker.processLogLine(hideoutGenerationLine);
        expect(eventSpy).not.toHaveBeenCalled();

        tracker.processLogLine(anotherMapGenerationLine);

        expect(eventSpy).toHaveBeenCalledTimes(1);
        const completedMap = eventSpy.mock.calls[0][0].detail.map;
        expect(completedMap).toBeDefined();
        expect(completedMap.name).toBe("MapBeach");
        expect(completedMap.areaLevel).toBe(83);
        expect(completedMap.seed).toBe(12345);
        expect(completedMap.span.end).toBeDefined();
    });

    test('should detect message from events', () => {
        const eventSpy = jest.fn();
        tracker.eventDispatcher.on("msgFrom", eventSpy);
        tracker.processLogLine("2023/06/15 12:34:58 123456789 abc [INFO Client 123] @From PlayerOne: Hello there!");
        expect(eventSpy).toHaveBeenCalled();
        const eventDetail = eventSpy.mock.calls[0][0].detail;
        expect(eventDetail.character).toBe("PlayerOne");
        expect(eventDetail.msg).toBe("Hello there!");
    });

    test('should detect message to events', () => {
        const eventSpy = jest.fn();
        tracker.eventDispatcher.on("msgTo", eventSpy);
        tracker.processLogLine("2023/06/15 12:34:59 123456789 abc [INFO Client 123] @To PlayerTwo: How are you?");
        expect(eventSpy).toHaveBeenCalled();
        const eventDetail = eventSpy.mock.calls[0][0].detail;
        expect(eventDetail.character).toBe("PlayerTwo");
        expect(eventDetail.msg).toBe("How are you?");
    });

    test('should detect player slain events', () => {
        const eventSpy = jest.fn();
        tracker.eventDispatcher.on("death", eventSpy);
        tracker.processLogLine("2023/06/15 12:35:00 123456789 abc [INFO Client 123] : PlayerThree has been slain");
        expect(eventSpy).toHaveBeenCalled();
        const eventDetail = eventSpy.mock.calls[0][0].detail;
        expect(eventDetail.character).toBe("PlayerThree");
    });

    test('should detect player joined area events', () => {
        const eventSpy = jest.fn();
        tracker.eventDispatcher.on("joinedArea", eventSpy);
        tracker.processLogLine("2023/06/15 12:35:01 123456789 abc [INFO Client 123] : PlayerFour has joined the area");
        expect(eventSpy).toHaveBeenCalled();
        const eventDetail = eventSpy.mock.calls[0][0].detail;
        expect(eventDetail.character).toBe("PlayerFour");
    });

    test('should detect player left area events', () => {
        const eventSpy = jest.fn();
        tracker.eventDispatcher.on("leftArea", eventSpy);
        tracker.processLogLine("2023/06/15 12:35:02 123456789 abc [INFO Client 123] : PlayerFive has left the area");
        expect(eventSpy).toHaveBeenCalled();
        const eventDetail = eventSpy.mock.calls[0][0].detail;
        expect(eventDetail.character).toBe("PlayerFive");
    });

    test('should detect level up events', () => {
        const eventSpy = jest.fn();
        tracker.eventDispatcher.on("levelUp", eventSpy);
        tracker.processLogLine("2023/06/15 12:35:03 123456789 abc [INFO Client 123] : PlayerSix (Witch) is now level 90");
        expect(eventSpy).toHaveBeenCalled();
        const eventDetail = eventSpy.mock.calls[0][0].detail;
        expect(eventDetail.character).toBe("PlayerSix");
        expect(eventDetail.ascendancy).toBe("Witch");
        expect(eventDetail.level).toBe("90");
    });

    test('should detect trade accepted events', () => {
        const eventSpy = jest.fn();
        tracker.eventDispatcher.on("tradeAccepted", eventSpy);
        tracker.processLogLine("2023/06/15 12:35:04 123456789 abc [INFO Client 123] : Trade accepted.");
        expect(eventSpy).toHaveBeenCalled();
    });

    test('should detect items identified events', () => {
        const eventSpy = jest.fn();
        tracker.eventDispatcher.on("itemsIdentified", eventSpy);
        tracker.processLogLine("2023/06/15 12:35:05 123456789 abc [INFO Client 123] : 5 Items identified");
        expect(eventSpy).toHaveBeenCalled();
        const eventDetail = eventSpy.mock.calls[0][0].detail;
        expect(eventDetail.count).toBe(5);
    });

});
