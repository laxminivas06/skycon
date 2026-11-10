#ifndef LOCKFREE_RING_BUFFER_H
#define LOCKFREE_RING_BUFFER_H

#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include "esp_heap_caps.h"

/**
 * =====================================================================================
 * SAE INDIA 2026 — S500-AeroRecon Telemetry Relay Firmware
 * Lock-Free Circular Ring Buffer for High-Rate Hardware UART (TELEM2)
 *
 * SPECIFICATION:
 * - Size: 16384 bytes (16 KB, >= 16 KB requirement) in internal DRAM (SRAM).
 * - Thread-Safe Single-Producer / Single-Consumer (SPSC) design.
 * - Hardware UART ISR / DMA reader pushes bytes; Core 1 MAVLink parser peeks & consumes.
 * - Zero-copy peek capabilities to allow in-buffer framing verification without data copies.
 * - Hardware memory barriers (__sync_synchronize()) guarantee memory visibility across cores.
 * =====================================================================================
 */

#define UART_RING_BUF_SIZE 16384 // 16 KB (Must be a power of 2)
#define UART_RING_BUF_MASK (UART_RING_BUF_SIZE - 1)

class LockFreeRingBuffer {
private:
    uint8_t* _buffer;
    bool _isDynamicallyAllocated;
    uint8_t _staticBuffer[UART_RING_BUF_SIZE]; // Fallback internal static storage

    volatile uint32_t _head; // Written by Producer (UART reader)
    volatile uint32_t _tail; // Written by Consumer (Core 1 MAVLink parser)
    volatile uint32_t _overrunCount;
    volatile uint32_t _totalBytesPushed;
    volatile uint32_t _totalBytesPopped;

public:
    LockFreeRingBuffer()
        : _buffer(nullptr),
          _isDynamicallyAllocated(false),
          _head(0),
          _tail(0),
          _overrunCount(0),
          _totalBytesPushed(0),
          _totalBytesPopped(0) {
    }

    /**
     * Initializes the buffer in internal SRAM (DRAM).
     * Avoids external PSRAM to eliminate cache coherency stalls and latency spikes.
     */
    bool init() {
        _head = 0;
        _tail = 0;
        _overrunCount = 0;
        _totalBytesPushed = 0;
        _totalBytesPopped = 0;

        // Attempt allocation in fast internal 8-bit accessible SRAM
        _buffer = (uint8_t*)heap_caps_malloc(UART_RING_BUF_SIZE, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
        if (_buffer != nullptr) {
            _isDynamicallyAllocated = true;
            memset(_buffer, 0, UART_RING_BUF_SIZE);
            return true;
        }

        // Fallback to static internal array if heap allocation fails
        _buffer = _staticBuffer;
        _isDynamicallyAllocated = false;
        memset(_buffer, 0, UART_RING_BUF_SIZE);
        return true;
    }

    ~LockFreeRingBuffer() {
        if (_isDynamicallyAllocated && _buffer != nullptr) {
            free(_buffer);
            _buffer = nullptr;
        }
    }

    /**
     * Number of available bytes in the ring buffer for reading.
     */
    inline size_t available() const {
        uint32_t h = _head;
        uint32_t t = _tail;
        return (h - t);
    }

    /**
     * Number of free bytes available for pushing.
     */
    inline size_t freeSpace() const {
        return UART_RING_BUF_SIZE - available() - 1;
    }

    inline bool isEmpty() const {
        return _head == _tail;
    }

    inline bool isFull() const {
        return available() >= (UART_RING_BUF_SIZE - 1);
    }

    /**
     * Pushes a single byte into the ring buffer.
     * Producer: Core 1 UART drain / ISR.
     */
    inline bool push(uint8_t b) {
        if (_buffer == nullptr) return false;

        uint32_t h = _head;
        uint32_t t = _tail;

        if ((h - t) >= (UART_RING_BUF_SIZE - 1)) {
            _overrunCount++;
            return false; // Buffer full
        }

        _buffer[h & UART_RING_BUF_MASK] = b;
        __sync_synchronize(); // Ensure byte write completes before head pointer update
        _head = h + 1;
        _totalBytesPushed++;
        return true;
    }

    /**
     * Pushes multiple bytes into the ring buffer.
     */
    size_t push_n(const uint8_t* data, size_t len) {
        if (_buffer == nullptr || data == nullptr || len == 0) return 0;

        uint32_t h = _head;
        uint32_t t = _tail;
        size_t availSpace = UART_RING_BUF_SIZE - (h - t) - 1;
        size_t toWrite = (len < availSpace) ? len : availSpace;

        if (toWrite < len) {
            _overrunCount += (len - toWrite);
        }

        for (size_t i = 0; i < toWrite; i++) {
            _buffer[(h + i) & UART_RING_BUF_MASK] = data[i];
        }

        __sync_synchronize();
        _head = h + toWrite;
        _totalBytesPushed += toWrite;
        return toWrite;
    }

    /**
     * Pops a single byte from the ring buffer.
     * Consumer: Core 1 MAVLink parser.
     */
    inline bool pop(uint8_t& b) {
        if (_buffer == nullptr) return false;

        uint32_t h = _head;
        uint32_t t = _tail;

        if (h == t) return false; // Empty

        b = _buffer[t & UART_RING_BUF_MASK];
        __sync_synchronize();
        _tail = t + 1;
        _totalBytesPopped++;
        return true;
    }

    /**
     * Zero-copy peek: reads a byte at given offset from tail without advancing tail.
     */
    inline uint8_t peek(size_t offset = 0) const {
        if (_buffer == nullptr || offset >= available()) return 0;
        return _buffer[(_tail + offset) & UART_RING_BUF_MASK];
    }

    /**
     * Copies 'len' bytes starting at 'offset' from tail into 'dest' without consuming them.
     */
    bool peek_n(size_t offset, uint8_t* dest, size_t len) const {
        if (_buffer == nullptr || dest == nullptr) return false;
        if (offset + len > available()) return false;

        uint32_t t = _tail + offset;
        for (size_t i = 0; i < len; i++) {
            dest[i] = _buffer[(t + i) & UART_RING_BUF_MASK];
        }
        return true;
    }

    /**
     * Advances the tail pointer by 'count' bytes after a frame has been inspected or discarded.
     */
    inline void consume(size_t count) {
        if (count == 0) return;
        uint32_t avail = available();
        uint32_t toConsume = (count < avail) ? count : avail;
        __sync_synchronize();
        _tail += toConsume;
        _totalBytesPopped += toConsume;
    }

    /**
     * Resets the ring buffer pointers to empty state.
     */
    void clear() {
        __sync_synchronize();
        _tail = _head;
    }

    inline uint32_t getOverrunCount() const { return _overrunCount; }
    inline uint32_t getTotalPushed() const { return _totalBytesPushed; }
    inline uint32_t getTotalPopped() const { return _totalBytesPopped; }
};

#endif // LOCKFREE_RING_BUFFER_H
