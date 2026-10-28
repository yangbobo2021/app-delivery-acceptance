package example;

public final class Pricing {
    public record Quote(long original, long payable) {}

    public Quote quote(long cents, boolean campaignEnabled) {
        if (cents < 0) throw new IllegalArgumentException("negative amount");
        long payable = campaignEnabled && cents >= 10_000 ? cents * 9 / 10 : cents;
        return new Quote(cents, payable);
    }

    public String campaignLabel() { return "10% discount from 10000 cents"; }
}
