package example;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import static org.junit.jupiter.api.Assertions.*;

class PricingTest {
    private final Pricing pricing = new Pricing();

    private void verify(long amount, long expected) {
        Pricing.Quote quote = pricing.quote(amount, true);
        assertEquals(amount, quote.original());
        assertEquals(expected, quote.payable());
    }

    @ParameterizedTest(name = "amount={0} payable={1}")
    @CsvSource({"9999,9999", "10000,9000", "10010,9009"})
    void bracketEdges(long amount, long expected) {
        verify(amount, expected);
    }

    @Test void quoteCanBeObtained() {
        assertNotNull(pricing.quote(10000, true));
    }

    @Test void campaignCanBeDisabled() {
        assertEquals(20000, pricing.quote(20000, false).payable());
    }

    @Test void discountThresholdIsAdvertised() {
        assertTrue(pricing.campaignLabel().contains("10000"));
    }

    @Test void negativeAmountsAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> pricing.quote(-1, true));
    }
}
